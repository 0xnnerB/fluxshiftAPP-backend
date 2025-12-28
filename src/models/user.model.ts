import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// ===== INTERFACES =====
export interface WalletAddress {
  blockchain: string;
  address: string;
  walletId: string;
  createdAt: Date;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  circleWalletSetId: string | null;
  walletIds: Record<string, string>;
  walletAddresses: WalletAddress[];
  createdAt: Date;
  updatedAt: Date;
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

// ===== MONGOOSE SCHEMAS =====
const WalletAddressSchema = new Schema({
  blockchain: { type: String, required: true },
  address: { type: String, required: true },
  walletId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const UserSchema = new Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, default: null },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, default: null },
  circleWalletSetId: { type: String, default: null },
  walletIds: { type: Object, default: {} },
  walletAddresses: { type: [WalletAddressSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const TransferSchema = new Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  sourceChain: { type: String, required: true },
  destinationChain: { type: String, required: true },
  amount: { type: String, required: true },
  status: { type: String, default: 'pending' },
  burnTxHash: { type: String, default: null },
  mintTxHash: { type: String, default: null },
  message: { type: String, default: null },
  attestation: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ===== MONGOOSE MODELS =====
const UserModel = mongoose.model('User', UserSchema);
const TransferModel = mongoose.model('Transfer', TransferSchema);

// ===== HELPER FUNCTIONS =====
function docToUser(doc: any): User | undefined {
  if (!doc) return undefined;
  return {
    id: doc.id,
    email: doc.email,
    passwordHash: doc.passwordHash,
    twoFactorEnabled: doc.twoFactorEnabled || false,
    twoFactorSecret: doc.twoFactorSecret,
    circleWalletSetId: doc.circleWalletSetId,
    walletIds: doc.walletIds || {},
    walletAddresses: (doc.walletAddresses || []).map((wa: any) => ({
      blockchain: wa.blockchain,
      address: wa.address,
      walletId: wa.walletId,
      createdAt: wa.createdAt
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function docToTransfer(doc: any): Transfer | undefined {
  if (!doc) return undefined;
  return {
    id: doc.id,
    userId: doc.userId,
    sourceChain: doc.sourceChain,
    destinationChain: doc.destinationChain,
    amount: doc.amount,
    status: doc.status as TransferStatus,
    burnTxHash: doc.burnTxHash,
    mintTxHash: doc.mintTxHash,
    message: doc.message,
    attestation: doc.attestation,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

// ===== USER STORE CLASS =====
class UserStore {
  async createUser(email: string, passwordHash: string | null = null): Promise<User> {
    const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return docToUser(existingUser)!;
    }

    const user = new UserModel({
      id: uuidv4(),
      email: email.toLowerCase(),
      passwordHash,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      circleWalletSetId: null,
      walletIds: {},
      walletAddresses: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await user.save();
    logger.info(`✅ Created new user: ${email}`);
    return docToUser(user)!;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ id });
    return docToUser(user);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    return docToUser(user);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = await UserModel.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
    return docToUser(user);
  }

  async addWalletAddress(userId: string, blockchain: string, address: string, walletId: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ id: userId });
    if (!user) return undefined;

    // Update walletIds object
    const walletIds = user.walletIds || {};
    walletIds[blockchain] = walletId;
    user.walletIds = walletIds;

    // Find or add wallet address
    const existingIndex = user.walletAddresses.findIndex((wa: any) => wa.blockchain === blockchain);
    if (existingIndex >= 0) {
      user.walletAddresses[existingIndex] = {
        blockchain,
        address,
        walletId,
        createdAt: user.walletAddresses[existingIndex].createdAt
      } as any;
    } else {
      user.walletAddresses.push({
        blockchain,
        address,
        walletId,
        createdAt: new Date()
      } as any);
    }

    user.updatedAt = new Date();
    await user.save();
    return docToUser(user);
  }

  async getWalletIdForBlockchain(userId: string, blockchain: string): Promise<string | undefined> {
    const user = await UserModel.findOne({ id: userId });
    if (!user) return undefined;

    // Try from walletIds object first
    const walletIds = user.walletIds || {};
    if (walletIds[blockchain]) return walletIds[blockchain];

    // Fallback to walletAddresses
    const wa = user.walletAddresses.find((w: any) => w.blockchain === blockchain);
    return wa?.walletId;
  }

  async createTransfer(userId: string, sourceChain: string, destinationChain: string, amount: string): Promise<Transfer> {
    const transfer = new TransferModel({
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
      updatedAt: new Date()
    });

    await transfer.save();
    return docToTransfer(transfer)!;
  }

  async updateTransfer(id: string, updates: Partial<Transfer>): Promise<Transfer | undefined> {
    const transfer = await TransferModel.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
    return docToTransfer(transfer);
  }

  async getTransferById(id: string): Promise<Transfer | undefined> {
    const transfer = await TransferModel.findOne({ id });
    return docToTransfer(transfer);
  }

  async getTransfersByUser(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({ userId }).sort({ createdAt: -1 });
    return transfers.map(t => docToTransfer(t)!).filter(Boolean);
  }

  async getPendingTransfers(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({
      userId,
      status: { $nin: ['completed', 'failed'] }
    }).sort({ createdAt: -1 });
    return transfers.map(t => docToTransfer(t)!).filter(Boolean);
  }

  async getCompletedTransfers(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({
      userId,
      status: { $in: ['completed', 'failed'] }
    }).sort({ createdAt: -1 });
    return transfers.map(t => docToTransfer(t)!).filter(Boolean);
  }

  async getAllUsers(): Promise<User[]> {
    const users = await UserModel.find({});
    return users.map(u => docToUser(u)!).filter(Boolean);
  }

  // ===== 2FA OPERATIONS =====
  async setTwoFactorSecret(userId: string, secret: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { twoFactorSecret: secret, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }

  async enableTwoFactor(userId: string): Promise<boolean> {
    const user = await UserModel.findOne({ id: userId });
    if (!user || !user.twoFactorSecret) return false;

    const result = await UserModel.updateOne(
      { id: userId },
      { twoFactorEnabled: true, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }

  async disableTwoFactor(userId: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { twoFactorEnabled: false, twoFactorSecret: null, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { passwordHash, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }
}

export const userStore = new UserStore();
