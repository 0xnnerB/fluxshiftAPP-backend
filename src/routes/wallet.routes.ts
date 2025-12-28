import { Router, Request, Response } from 'express';
import { userService } from '../services/user.service.js';
import { cctpService } from '../services/cctp.service.js';
import { circleWalletService } from '../services/circleWallet.service.js';
import { CHAINS } from '../config/chains.js';
import { logger } from '../utils/logger.js';

const router = Router();

// GET /api/wallet/chains - Get supported chains
router.get('/chains', (req: Request, res: Response) => {
  const chains = Object.entries(CHAINS).map(([key, chain]) => ({
    key,
    name: chain.name,
    chainId: chain.chainId,
    cctpDomain: chain.cctpDomain,
    circleBlockchain: chain.circleBlockchain,
    usdc: chain.usdc,
    explorer: chain.explorer,
  }));

  res.json({
    success: true,
    data: { chains },
  });
});

// GET /api/wallet/:userId/addresses - Get all wallet addresses
router.get('/:userId/addresses', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const addresses = userService.getAllWalletAddresses(userId);

    if (addresses.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No wallet addresses found',
      });
    }

    res.json({
      success: true,
      data: { addresses },
    });
  } catch (error: any) {
    logger.error('Get addresses failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/wallet/:userId/balances - Get all USDC and ETH balances
router.get('/:userId/balances', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const user = userService.getUser(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const balances = [];
    for (const wa of user.walletAddresses) {
      const chainEntry = Object.entries(CHAINS).find(
        ([_, chain]) => chain.circleBlockchain === wa.blockchain
      );
      
      if (chainEntry) {
        const [chainKey, chain] = chainEntry;
        try {
          const usdcBalance = await cctpService.getUsdcBalance(wa.address, chainKey);
          const ethBalance = await cctpService.getEthBalance(wa.address, chainKey);
          balances.push({
            blockchain: wa.blockchain,
            chainKey,
            chainName: chain.name,
            address: wa.address,
            usdc: usdcBalance,
            eth: ethBalance,
          });
        } catch (error) {
          balances.push({
            blockchain: wa.blockchain,
            chainKey,
            chainName: chain.name,
            address: wa.address,
            usdc: '0',
            eth: '0',
          });
        }
      }
    }

    res.json({
      success: true,
      data: { balances },
    });
  } catch (error: any) {
    logger.error('Get balances failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/wallet/:userId/balance/:chainKey - Get balance for specific chain
router.get('/:userId/balance/:chainKey', async (req: Request, res: Response) => {
  try {
    const { userId, chainKey } = req.params;
    const chain = CHAINS[chainKey];

    if (!chain) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chain',
      });
    }

    const address = userService.getWalletAddress(userId, chain.circleBlockchain);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Wallet address not found for this chain',
      });
    }

    const balance = await cctpService.getUsdcBalance(address, chainKey);

    res.json({
      success: true,
      data: {
        chainKey,
        chainName: chain.name,
        address,
        usdc: balance,
      },
    });
  } catch (error: any) {
    logger.error('Get balance failed:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/wallet/withdraw - Withdraw USDC to external address
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const { userId, chainKey, toAddress, amount } = req.body;

    // Validações
    if (!userId || !chainKey || !toAddress || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, chainKey, toAddress, amount',
      });
    }

    // Validar endereço
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid destination address format',
      });
    }

    // Validar amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
    }

    const chain = CHAINS[chainKey];
    if (!chain) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chain',
      });
    }

    const user = userService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Pegar walletId para a chain específica
    const walletId = userService.getWalletIdForChainKey(userId, chainKey);
    if (!walletId) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found for this chain',
      });
    }

    // Converter amount para unidades USDC (6 decimais)
    const amountInUnits = Math.floor(amountNum * 1_000_000).toString();

    logger.info(`[WITHDRAW] Starting: ${amount} USDC on ${chainKey} to ${toAddress}`);
    logger.info(`[WITHDRAW] WalletId: ${walletId}`);
    logger.info(`[WITHDRAW] USDC Contract: ${chain.usdc}`);

    // Executar transfer usando Circle API
    const transferResult = await circleWalletService.executeContract(
      walletId,
      chain.circleBlockchain,
      chain.usdc,
      'transfer(address,uint256)',
      [toAddress, amountInUnits]
    );

    logger.info(`[WITHDRAW] Transaction initiated: ${transferResult.transaction.id}`);

    // Aguardar confirmação
    const confirmedTx = await circleWalletService.waitForTransaction(
      transferResult.transaction.id,
      60,
      3000
    );

    const txHash = confirmedTx.transaction.txHash || '';

    logger.info(`[WITHDRAW] Completed! TxHash: ${txHash}`);

    res.json({
      success: true,
      data: {
        transactionId: confirmedTx.transaction.id,
        txHash,
        amount,
        toAddress,
        chainKey,
        chainName: chain.name,
        explorerUrl: `${chain.explorer}/tx/${txHash}`,
      },
    });
  } catch (error: any) {
    logger.error('[WITHDRAW] Failed:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Withdraw failed',
    });
  }
});

export default router;
