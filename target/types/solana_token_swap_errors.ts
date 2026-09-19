
export const SolanaTokenSwapErrorCode = {
  ZeroAmount: 6000,
  PriceNotSet: 6001,
  InsufficientLiquidity: 6002,
  MathOverflow: 6003,
  ZeroOutput: 6004,
  SlippageExceeded: 6005,
  MintOrder: 6006,
  Unauthorized: 6007,
  InvalidMint: 6008
};

export type SolanaTokenSwapErrorName = keyof typeof SolanaTokenSwapErrorCode;
