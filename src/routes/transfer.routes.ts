import { Router, Request, Response } from 'express';
import { userService } from '../services/user.service.js';
import { cctpService } from '../services/cctp.service.js';
import { CHAINS } from '../config/chains.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/transfer/bridge - Initiate bridge (manual mode)
router.post('/bridge', async (req: Request, res: Response) => {
  try {
    const { userId, sourceChain, destinationChain, amount, recipientAddress } = req.body;

    if (!userId || !sourceChain || !destinationChain || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, sourceChain, destinationChain, amount',
      });
    }

    const user = userService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const result = await cctpService.initiateBridge(
      userId,
      sourceChain,
      destinationChain,
      amount,
      recipientAddress
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Bridge initiation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/transfer/bridge-auto - Full automated bridge
router.post('/bridge-auto', async (req: Request, res: Response) => {
  try {
    const { userId, sourceChain, destinationChain, amount } = req.body;

    // LOG DETALHADO DO REQUEST
    logger.info(`[BRIDGE-AUTO] Received request body: ${JSON.stringify(req.body)}`);
    logger.info(`[BRIDGE-AUTO] sourceChain: "${sourceChain}" | destinationChain: "${destinationChain}"`);

    if (!userId || !sourceChain || !destinationChain || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, sourceChain, destinationChain, amount',
      });
    }

    const user = userService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    logger.info(`[BRIDGE-AUTO] Starting bridge: ${amount} USDC from ${sourceChain} to ${destinationChain}`);

    const result = await cctpService.executeBridgeFlow(
      userId,
      sourceChain,
      destinationChain,
      amount
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Auto bridge failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/transfer/:transferId/status - Get transfer status
router.get('/:transferId/status', async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;
    const status = await cctpService.getBridgeStatus(transferId);

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error('Get transfer status failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/transfer/:transferId/complete - Complete pending mint
router.post('/:transferId/complete', async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;
    const status = await cctpService.getBridgeStatus(transferId);

    if (status.status !== 'ready_to_mint') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete transfer in status: ${status.status}`,
      });
    }

    const transfer = await userService.getTransfer(transferId);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }

    if (!status.message || !status.attestation) {
      return res.status(400).json({
        success: false,
        message: 'Missing message or attestation',
      });
    }

    const result = await cctpService.completeBridge(
      transferId,
      transfer.userId,
      status.message,
      status.attestation
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Complete transfer failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/transfer/user/:userId/history - Get user transfer history
router.get('/user/:userId/history', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const history = userService.getTransferHistory(userId);

    res.json({
      success: true,
      data: history,
    });
  } catch (error: any) {
    logger.error('Get transfer history failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/transfer/check-attestation - Check attestation manually
router.post('/check-attestation', async (req: Request, res: Response) => {
  try {
    const { burnTxHash, sourceDomain } = req.body;

    if (!burnTxHash || sourceDomain === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing burnTxHash or sourceDomain',
      });
    }

    const attestation = await cctpService.checkAttestation(burnTxHash, sourceDomain);

    res.json({
      success: true,
      data: attestation,
    });
  } catch (error: any) {
    logger.error('Check attestation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
