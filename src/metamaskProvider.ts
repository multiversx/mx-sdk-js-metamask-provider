import { MetaMaskInpageProvider } from '@metamask/providers';
import { Address, Message, Transaction } from '@multiversx/sdk-core/out';
import { defaultSnapOrigin } from './config';
import { safeWindow } from './constants';
import {
  ErrAccountNotConnected,
  ErrCannotSignSingleTransaction,
  ErrProviderNotInitialized,
  ErrCouldNotLogin,
  ErrCouldNotSignTransactions,
  ErrCouldNotSignMessage
} from './errors';
import { connectSnap, getSnap } from './snap';

export interface IMetamaskWalletAccount {
  address: string;
  name?: string;
  signature?: string;
}

declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider & {
      setProvider?: (provider: MetaMaskInpageProvider) => void;
      detected?: MetaMaskInpageProvider[];
      providers?: MetaMaskInpageProvider[];
    };
    isMetamask: boolean;
  }
}

export class MetamaskProvider {
  public account: IMetamaskWalletAccount = { address: '' };
  private initialized = false;
  private static _instance: MetamaskProvider;

  public static isMetamaskInstalled(): boolean {
    return MetamaskProvider.getMetamaskProvider() !== null;
  }

  private static getMetamaskProvider(): MetaMaskInpageProvider | null {
    const eth = safeWindow?.ethereum;

    if (!eth) {
      return null;
    }

    if (eth.isMetaMask && typeof eth.request === 'function') {
      return eth;
    }

    const providers = eth.providers ?? eth.detected ?? [];

    for (const provider of providers) {
      if (provider.isMetaMask && typeof provider.request === 'function') {
        if (typeof eth.setProvider === 'function') {
          eth.setProvider(provider);
        }

        return provider;
      }
    }

    return null;
  }

  public static getInstance(): MetamaskProvider {
    if (!MetamaskProvider._instance) {
      MetamaskProvider._instance = new MetamaskProvider();
    }

    return MetamaskProvider._instance;
  }

  public setAddress(address: string): MetamaskProvider {
    this.account.address = address;

    return MetamaskProvider._instance;
  }

  getAccount(): IMetamaskWalletAccount | null {
    return this.account;
  }

  setAccount(account: IMetamaskWalletAccount): void {
    this.account = account;
  }

  async init(): Promise<boolean> {
    const hasMetamask = MetamaskProvider.isMetamaskInstalled();

    if (hasMetamask && !this.initialized) {
      try {
        await connectSnap(defaultSnapOrigin, { version: '2.0.0' });
        const installedSnap = await getSnap();
        this.initialized = installedSnap !== undefined;
      } catch (error) {
        console.error('MetamaskProvider init failed:', error);
        this.initialized = false;
      }
    }

    return this.initialized;
  }

  async login(
    options: {
      token?: string;
    } = {}
  ): Promise<IMetamaskWalletAccount> {
    const token = options.token;

    if (!this.initialized) {
      throw new ErrProviderNotInitialized();
    }

    try {
      const provider = MetamaskProvider.getMetamaskProvider();

      if (!provider) {
        throw new ErrCouldNotLogin();
      }

      const addressResponse = await provider.request({
        method: 'wallet_invokeSnap',
        params: {
          snapId: defaultSnapOrigin,
          request: {
            method: 'mvx_getAddress'
          }
        }
      });

      if (!addressResponse || typeof addressResponse !== 'string') {
        throw new ErrCouldNotLogin();
      }

      this.account.address = addressResponse;

      if (token) {
        const tokenResponse = await provider.request({
          method: 'wallet_invokeSnap',
          params: {
            snapId: defaultSnapOrigin,
            request: {
              method: 'mvx_signAuthToken',
              params: { token: token }
            }
          }
        });

        if (!tokenResponse || typeof tokenResponse !== 'string') {
          throw new ErrCouldNotLogin();
        }

        this.account.signature = tokenResponse;
      }
    } catch (error: any) {
      console.error('MetamaskProvider login failed:', error);
      throw new ErrCouldNotLogin();
    }

    return this.account;
  }

  async logout(): Promise<boolean> {
    if (!this.initialized) {
      throw new ErrProviderNotInitialized();
    }

    this.account = { address: '' };

    return true;
  }

  async getAddress(): Promise<string> {
    if (!this.initialized) {
      throw new ErrProviderNotInitialized();
    }

    return this.account?.address ?? '';
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isConnected(): boolean {
    return Boolean(this.account.address);
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    const signedTransactions = await this.signTransactions([transaction]);

    if (signedTransactions.length != 1) {
      throw new ErrCannotSignSingleTransaction();
    }

    return signedTransactions[0];
  }

  async signTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    try {
      this.ensureConnected();
      const provider = MetamaskProvider.getMetamaskProvider();

      if (!provider) {
        throw new ErrCouldNotSignTransactions();
      }

      const transactionsPlain = transactions.map((transaction) =>
        transaction.toPlainObject()
      );

      const signResponse = await provider.request({
        method: 'wallet_invokeSnap',
        params: {
          snapId: defaultSnapOrigin,
          request: {
            method: 'mvx_signTransactions',
            params: { transactions: transactionsPlain }
          }
        }
      });

      if (!Array.isArray(signResponse)) {
        throw new ErrCouldNotSignTransactions();
      }

      const transactionsResponse = signResponse.map((transaction: string) =>
        Transaction.newFromPlainObject(JSON.parse(transaction))
      );

      return transactionsResponse;
    } catch (error) {
      console.error('MetamaskProvider signTransactions failed:', error);
      throw new ErrCouldNotSignTransactions();
    }
  }

  async signMessage(messageToSign: Message): Promise<Message> {
    try {
      this.ensureConnected();
      const provider = MetamaskProvider.getMetamaskProvider();

      if (!provider) {
        throw new ErrCouldNotSignMessage();
      }

      const signResponse = await provider.request({
        method: 'wallet_invokeSnap',
        params: {
          snapId: defaultSnapOrigin,
          request: {
            method: 'mvx_signMessage',
            params: { message: Buffer.from(messageToSign.data).toString() }
          }
        }
      });

      if (!signResponse || typeof signResponse !== 'string') {
        throw new ErrCouldNotSignMessage();
      }

      return new Message({
        data: Buffer.from(messageToSign.data),
        address:
          messageToSign.address ?? Address.newFromBech32(this.account.address),
        signer: 'metamask',
        version: messageToSign.version,
        signature: Buffer.from(signResponse, 'hex')
      });
    } catch (error) {
      console.error('MetamaskProvider signMessage failed:', error);
      throw new ErrCouldNotSignMessage();
    }
  }

  cancelAction() {
    return false;
  }

  private ensureConnected() {
    const hasMetamask = MetamaskProvider.isMetamaskInstalled();

    if (!this.account.address || !hasMetamask) {
      throw new ErrAccountNotConnected();
    }
  }
}
