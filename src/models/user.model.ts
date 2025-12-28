import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '../../data/users.json');
const DATA_DIR = path.join(__dirname, '../../data');

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;  // Hash bcrypt da senha
  twoFactorEnabled: boolean;    // 2FA ativado?
  twoFactorSecret: string | null; // Secret TOTP
  circleWalletSetId: string | null;
  // Mapa de blockchain -> walletId (cada chain tem seu próprio walletId!)
  walletIds: Record<string, string>;
  walletAddresses: WalletAddress[];
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletAddress {
  blockchain: string;
  address: string;
  walletId: string;  // Agora cada address tem seu walletId associado
  createdAt: Date;
}

export interface Transfer {
  id: string;
  userId: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  status: TransferStatus;
  burnTxHash: string | null;
  mintTxHash: string | null;
  message: string | null;
  attestation: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TransferStatus = 
  | 'pending'
  | 'burning'
  | 'waiting_attestation'
  | 'ready_to_mint'
  | 'minting'
  | 'completed'
  | 'failed';

interface StorageData {
  users: Record<string, User>;
  usersByEmail: Record<string, string>;
  transfers: Record<string, Transfer>;
  transfersByUser: Record<string, string[]>;
}

class UserStore {
  private users: Map<string, User> = new Map();
  private usersByEmail: Map<string, string> = new Map();
  private transfers: Map<string, Transfer> = new Map();
  private transfersByUser: Map<string, string[]> = new Map();

  constructor() {
    this.loadFromFile();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadFromFile(): void {
    try {
      this.ensureDataDir();
      
      if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed: StorageData = JSON.parse(data);
        
        for (const [id, user] of Object.entries(parsed.users || {})) {
          user.createdAt = new Date(user.createdAt);
          user.updatedAt = new Date(user.updatedAt);
          user.walletIds = user.walletIds || {};
          user.walletAddresses = (user.walletAddresses || []).map(wa => ({
            ...wa,
            walletId: wa.walletId || '',
            createdAt: new Date(wa.createdAt)
          }));
          this.users.set(id, user);
        }
        
        for (const [email, id] of Object.entries(parsed.usersByEmail || {})) {
          this.usersByEmail.set(email, id);
        }
        
        for (const [id, transfer] of Object.entries(parsed.transfers || {})) {
          transfer.createdAt = new Date(transfer.createdAt);
          transfer.updatedAt = new Date(transfer.updatedAt);
          this.transfers.set(id, transfer);
        }
        
        for (const [userId, transferIds] of Object.entries(parsed.transfersByUser || {})) {
          this.transfersByUser.set(userId, transferIds);
        }
        
        console.log(`✅ Loaded ${this.users.size} users and ${this.transfers.size} transfers from storage`);
      }
    } catch (error) {
      console.error('Failed to load data from file:', error);
    }
  }

  private saveToFile(): void {
    try {
      this.ensureDataDir();
      
      const data: StorageData = {
        users: Object.fromEntries(this.users),
        usersByEmail: Object.fromEntries(this.usersByEmail),
        transfers: Object.fromEntries(this.transfers),
        transfersByUser: Object.fromEntries(this.transfersByUser),
      };
      
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save data to file:', error);
    }
  }

  createUser(email: string, passwordHash: string | null = null): User {
    const existingUserId = this.usersByEmail.get(email.toLowerCase());
    if (existingUserId) {
      const existingUser = this.users.get(existingUserId);
      if (existingUser) {
        return existingUser;
      }
    }

    const user: User = {
      id: uuidv4(),
      email: email.toLowerCase(),
      passwordHash: passwordHash,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      circleWalletSetId: null,
      walletIds: {},
      walletAddresses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.saveToFile();
    return user;
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    const userId = this.usersByEmail.get(email.toLowerCase());
    if (!userId) return undefined;
    return this.users.get(userId);
  }

  updateUser(id: string, updates: Partial<User>): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date(),
    };
    this.users.set(id, updatedUser);
    this.saveToFile();
    return updatedUser;
  }

  addWalletAddress(userId: string, blockchain: string, address: string, walletId: string): User | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;

    // Atualiza o mapa walletIds
    user.walletIds[blockchain] = walletId;

    const existingIndex = user.walletAddresses.findIndex(wa => wa.blockchain === blockchain);

    if (existingIndex >= 0) {
      user.walletAddresses[existingIndex] = {
        blockchain,
        address,
        walletId,
        createdAt: user.walletAddresses[existingIndex].createdAt,
      };
    } else {
      user.walletAddresses.push({
        blockchain,
        address,
        walletId,
        createdAt: new Date(),
      });
    }

    user.updatedAt = new Date();
    this.users.set(userId, user);
    this.saveToFile();
    return user;
  }

  getWalletIdForBlockchain(userId: string, blockchain: string): string | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    // Primeiro tenta do mapa walletIds
    if (user.walletIds[blockchain]) {
      return user.walletIds[blockchain];
    }
    
    // Fallback para walletAddresses
    const wa = user.walletAddresses.find(w => w.blockchain === blockchain);
    return wa?.walletId;
  }

  createTransfer(userId: string, sourceChain: string, destinationChain: string, amount: string): Transfer {
    const transfer: Transfer = {
      id: uuidv4(),
      userId,
      sourceChain,
      destinationChain,
      amount,
      status: 'pending',
      burnTxHash: null,
      mintTxHash: null,
      message: null,
      attestation: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.transfers.set(transfer.id, transfer);
    
    const userTransfers = this.transfersByUser.get(userId) || [];
    userTransfers.push(transfer.id);
    this.transfersByUser.set(userId, userTransfers);
    
    this.saveToFile();
    return transfer;
  }

  updateTransfer(id: string, updates: Partial<Transfer>): Transfer | undefined {
    const transfer = this.transfers.get(id);
    if (!transfer) return undefined;

    const updatedTransfer = {
      ...transfer,
      ...updates,
      updatedAt: new Date(),
    };
    this.transfers.set(id, updatedTransfer);
    this.saveToFile();
    return updatedTransfer;
  }

  getTransferById(id: string): Transfer | undefined {
    return this.transfers.get(id);
  }

  getTransfersByUser(userId: string): Transfer[] {
    const transferIds = this.transfersByUser.get(userId) || [];
    return transferIds
      .map(id => this.transfers.get(id))
      .filter((t): t is Transfer => t !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getPendingTransfers(userId: string): Transfer[] {
    return this.getTransfersByUser(userId).filter(
      t => t.status !== 'completed' && t.status !== 'failed'
    );
  }

  getCompletedTransfers(userId: string): Transfer[] {
    return this.getTransfersByUser(userId).filter(
      t => t.status === 'completed' || t.status === 'failed'
    );
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  // ===== 2FA OPERATIONS =====
  setTwoFactorSecret(userId: string, secret: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    user.twoFactorSecret = secret;
    user.updatedAt = new Date();
    this.saveToFile();
    return true;
  }

  enableTwoFactor(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user || !user.twoFactorSecret) return false;
    user.twoFactorEnabled = true;
    user.updatedAt = new Date();
    this.saveToFile();
    return true;
  }

  disableTwoFactor(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.updatedAt = new Date();
    this.saveToFile();
    return true;
  }

  updatePassword(userId: string, passwordHash: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    user.passwordHash = passwordHash;
    user.updatedAt = new Date();
    this.saveToFile();
    return true;
  }
}

export const userStore = new UserStore();
