import { MetaMaskInpageProvider } from '@metamask/providers';

export const isMetamaskProvider = (provider: MetaMaskInpageProvider) =>
  provider.isMetaMask;
