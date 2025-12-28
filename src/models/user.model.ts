import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// ===== INTERFACES =====
export interface WalletAddress {
  blockchain: string;
  address: string;
  walletId: string;
  createdAt: Date;
}

export interface IUser extends Document {
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

export interface ITransfer extends Document {
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

// Interfaces para compatibilidade com código existente
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

// ===== SCHEMAS =====
const WalletAddressSchema = new Schema({
  blockchain: { type: String, required: true },
  address: { type: String, required: true },
  walletId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const UserSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, default: null },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, default: null },
  circleWalletSetId: { type: String, default: null },
  walletIds: { type: Map, of: String, default: {} },
  walletAddresses: { type: [WalletAddressSchema], default: [] }
}, { 
  timestamps: true,
  toJSON: { 
    transform: (doc, ret) => {
      ret.walletIds = Object.fromEntries(ret.walletIds || new Map());
      return ret;
    }
  }
});

const TransferSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  sourceChain: { type: String, required: true },
  destinationChain: { type: String, required: true },
  amount: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'burning', 'waiting_attestation', 'ready_to_mint', 'minting', 'completed', 'failed'],
    default: 'pending'
  },
  burnTxHash: { type: String, default: null },
  mintTxHash: { type: String, default: null },
  message: { type: String, default: null },
  attestation: { type: String, default: null }
}, { timestamps: true });

// ===== MODELS =====
const UserModel = mongoose.model<IUser>('User', UserSchema);
const TransferModel = mongoose.model<ITransfer>('Transfer', TransferSchema);

// ===== USER STORE CLASS =====
class UserStore {
  private isConnected: boolean = false;

  async connect(mongoUri: string): Promise<void> {
    if (this.isConnected) return;
    
    try {
      await mongoose.connect(mongoUri, {
        dbName: 'fluxshift'
      });
      this.isConnected = true;
      console.log('✅ Connected to MongoDB Atlas');
      
      const userCount = await UserModel.countDocuments();
      const transferCount = await TransferModel.countDocuments();
      console.log(`✅ Loaded ${userCount} users and ${transferCount} transfers from MongoDB`);
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  private toPlainUser(doc: IUser | null): User | undefined {
    if (!doc) return undefined;
    const obj = doc.toJSON();
    return {
      id: obj.id,
      email: obj.email,
      passwordHash: obj.passwordHash,
      twoFactorEnabled: obj.twoFactorEnabled,
      twoFactorSecret: obj.twoFactorSecret,
      circleWalletSetId: obj.circleWalletSetId,
      walletIds: obj.walletIds || {},
      walletAddresses: obj.walletAddresses || [],
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt
    };
  }

  private toPlainTransfer(doc: ITransfer | null): Transfer | undefined {
    if (!doc) return undefined;
    return {
      id: doc.id,
      userId: doc.userId,
      sourceChain: doc.sourceChain,
      destinationChain: doc.destinationChain,
      amount: doc.amount,
      status: doc.status,
      burnTxHash: doc.burnTxHash,
      mintTxHash: doc.mintTxHash,
      message: doc.message,
      attestation: doc.attestation,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  async createUser(email: string, passwordHash: string | null = null): Promise<User> {
    const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return this.toPlainUser(existingUser)!;
    }

    const user = new UserModel({
      id: uuidv4(),
      email: email.toLowerCase(),
      passwordHash: passwordHash,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      circleWalletSetId: null,
      walletIds: new Map(),
      walletAddresses: []
    });

    await user.save();
    console.log(`✅ Created new user: ${email}`);
    return this.toPlainUser(user)!;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ id });
    return this.toPlainUser(user);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    return this.toPlainUser(user);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = await UserModel.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    );
    return this.toPlainUser(user);
  }

  async addWalletAddress(userId: string, blockchain: string, address: string, walletId: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ id: userId });
    if (!user) return undefined;

    // Atualiza walletIds
    user.walletIds.set(blockchain, walletId);

    // Atualiza ou adiciona walletAddress
    const existingIndex = user.walletAddresses.findIndex(wa => wa.blockchain === blockchain);
    if (existingIndex >= 0) {
      user.walletAddresses[existingIndex] = {
        blockchain,
        address,
        walletId,
        createdAt: user.walletAddresses[existingIndex].createdAt
      };
    } else {
      user.walletAddresses.push({
        blockchain,
        address,
        walletId,
        createdAt: new Date()
      });
    }

    await user.save();
    return this.toPlainUser(user);
  }

  async getWalletIdForBlockchain(userId: string, blockchain: string): Promise<string | undefined> {
    const user = await UserModel.findOne({ id: userId });
    if (!user) return undefined;
    
    // Primeiro tenta do mapa walletIds
    const walletId = user.walletIds.get(blockchain);
    if (walletId) return walletId;
    
    // Fallback para walletAddresses
    const wa = user.walletAddresses.find(w => w.blockchain === blockchain);
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
      attestation: null
    });

    await transfer.save();
    return this.toPlainTransfer(transfer)!;
  }

  async updateTransfer(id: string, updates: Partial<Transfer>): Promise<Transfer | undefined> {
    const transfer = await TransferModel.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    );
    return this.toPlainTransfer(transfer);
  }

  async getTransferById(id: string): Promise<Transfer | undefined> {
    const transfer = await TransferModel.findOne({ id });
    return this.toPlainTransfer(transfer);
  }

  async getTransfersByUser(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({ userId }).sort({ createdAt: -1 });
    return transfers.map(t => this.toPlainTransfer(t)!);
  }

  async getPendingTransfers(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({ 
      userId, 
      status: { $nin: ['completed', 'failed'] }
    }).sort({ createdAt: -1 });
    return transfers.map(t => this.toPlainTransfer(t)!);
  }

  async getCompletedTransfers(userId: string): Promise<Transfer[]> {
    const transfers = await TransferModel.find({ 
      userId, 
      status: { $in: ['completed', 'failed'] }
    }).sort({ createdAt: -1 });
    return transfers.map(t => this.toPlainTransfer(t)!);
  }

  async getAllUsers(): Promise<User[]> {
    const users = await UserModel.find();
    return users.map(u => this.toPlainUser(u)!);
  }

  // ===== 2FA OPERATIONS =====
  async setTwoFactorSecret(userId: string, secret: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { $set: { twoFactorSecret: secret } }
    );
    return result.modifiedCount > 0;
  }

  async enableTwoFactor(userId: string): Promise<boolean> {
    const user = await UserModel.findOne({ id: userId });
    if (!user || !user.twoFactorSecret) return false;
    
    const result = await UserModel.updateOne(
      { id: userId },
      { $set: { twoFactorEnabled: true } }
    );
    return result.modifiedCount > 0;
  }

  async disableTwoFactor(userId: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { $set: { twoFactorEnabled: false, twoFactorSecret: null } }
    );
    return result.modifiedCount > 0;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const result = await UserModel.updateOne(
      { id: userId },
      { $set: { passwordHash } }
    );
    return result.modifiedCount > 0;
  }
}

export const userStore = new UserStore();
