import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { userService } from '../services/user.service.js';
import { userStore } from '../models/user.model.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Domínios de email permitidos
const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com'];

function validateEmail(email: string): { valid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  const domain = email.split('@')[1].toLowerCase();
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    return { valid: false, error: `Only ${ALLOWED_EMAIL_DOMAINS.join(', ')} emails allowed` };
  }
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  return { valid: true };
}

// POST /api/auth/register - Register new user with password
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    // Validate email
    const emailVal = validateEmail(email);
    if (!emailVal.valid) {
      return res.status(400).json({ success: false, message: emailVal.error });
    }

    // Validate password
    const passVal = validatePassword(password);
    if (!passVal.valid) {
      return res.status(400).json({ success: false, message: passVal.error });
    }

    // Check if user exists
    const existing = userService.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered. Please login.',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user with wallets
    const result = await userService.createUser(email, passwordHash);

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        userId: result.user.id,
        email: result.user.email,
        wallets: result.wallets,
        twoFactorEnabled: result.user.twoFactorEnabled || false,
      },
    });
  } catch (error: any) {
    logger.error('Registration failed:', error);
    res.status(500).json({
      success: false,
      message: `Registration failed: ${error.message}`,
    });
  }
});

// POST /api/auth/login - Login with email, password, and optional 2FA
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, totpCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const user = userService.getUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please register first.',
      });
    }

    // Check password
    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'Account needs password reset. Please register again.',
      });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
      });
    }

    // Check 2FA if enabled
    if (user.twoFactorEnabled) {
      if (!totpCode) {
        return res.json({
          success: true,
          requires2FA: true,
          userId: user.id,
          message: 'Please enter your 2FA code',
        });
      }

      const isValidToken = authenticator.verify({
        token: totpCode,
        secret: user.twoFactorSecret!,
      });

      if (!isValidToken) {
        return res.status(401).json({
          success: false,
          message: 'Invalid 2FA code',
        });
      }
    }

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        wallets: user.walletAddresses.map(wa => ({
          blockchain: wa.blockchain,
          address: wa.address,
        })),
        twoFactorEnabled: user.twoFactorEnabled || false,
      },
    });
  } catch (error: any) {
    logger.error('Login failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/auth/2fa/setup - Setup 2FA
router.post('/2fa/setup', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID required' });
    }

    const user = userService.getUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'FluxShift', secret);

    // Save secret temporarily
    userStore.setTwoFactorSecret(userId, secret);

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    res.json({
      success: true,
      data: {
        secret,
        qrCodeUrl,
      },
    });
  } catch (error: any) {
    logger.error('2FA setup failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/auth/2fa/verify - Verify and enable 2FA
router.post('/2fa/verify', async (req: Request, res: Response) => {
  try {
    const { userId, totpCode } = req.body;

    if (!userId || !totpCode) {
      return res.status(400).json({ success: false, message: 'User ID and code required' });
    }

    const user = userService.getUser(userId);
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: '2FA not set up' });
    }

    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret,
    });

    if (isValid) {
      userStore.enableTwoFactor(userId);
      logger.info(`2FA enabled for: ${user.email}`);
      res.json({ success: true, message: '2FA enabled successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid code' });
    }
  } catch (error: any) {
    logger.error('2FA verify failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/auth/2fa/disable - Disable 2FA
router.post('/2fa/disable', async (req: Request, res: Response) => {
  try {
    const { userId, totpCode } = req.body;

    if (!userId || !totpCode) {
      return res.status(400).json({ success: false, message: 'User ID and code required' });
    }

    const user = userService.getUser(userId);
    if (!user || !user.twoFactorEnabled) {
      return res.status(400).json({ success: false, message: '2FA not enabled' });
    }

    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret!,
    });

    if (isValid) {
      userStore.disableTwoFactor(userId);
      logger.info(`2FA disabled for: ${user.email}`);
      res.json({ success: true, message: '2FA disabled successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid code' });
    }
  } catch (error: any) {
    logger.error('2FA disable failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/auth/user/:userId - Get user details
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const user = userService.getUser(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        wallets: user.walletAddresses.map(wa => ({
          blockchain: wa.blockchain,
          address: wa.address,
        })),
        twoFactorEnabled: user.twoFactorEnabled || false,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    logger.error('Get user failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
