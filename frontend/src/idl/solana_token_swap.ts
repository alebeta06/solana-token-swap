/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana_token_swap.json`.
 */
export type SolanaTokenSwap = {
  "address": "BJ7GHy1zRe1VKuKUZU2ac2q1VQmtukmHzCpbo98m21qp",
  "metadata": {
    "name": "solanaTokenSwap",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addLiquidity",
      "docs": [
        "Deposits tokens into the market vaults. Open to any depositor.",
        "🇪🇸 NOTA: no lleva `has_one = authority` — cualquiera puede aportar liquidez.",
        "Regalar tokens a una bóveda no hace daño: nadie puede sacarlos salvo por swap."
      ],
      "discriminator": [
        181,
        157,
        89,
        67,
        143,
        182,
        52,
        72
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.tokenMintA",
                "account": "marketAccount"
              },
              {
                "kind": "account",
                "path": "market.tokenMintB",
                "account": "marketAccount"
              }
            ]
          }
        },
        {
          "name": "vaultA",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vaultB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "depositorTokenA",
          "docs": [
            "🇪🇸 NOTA: ATA del depositante. El `constraint` impide que pase una cuenta",
            "de otro token — el caller elige las cuentas, así que hay que verificar."
          ],
          "writable": true
        },
        {
          "name": "depositorTokenB",
          "writable": true
        },
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeMarket",
      "docs": [
        "Creates a market for a token pair, plus its two vaults."
      ],
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ]
          }
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "vaultA",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vaultB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setPrice",
      "docs": [
        "Updates the exchange price. Only the market authority may call this."
      ],
      "discriminator": [
        16,
        19,
        182,
        8,
        149,
        83,
        72,
        181
      ],
      "accounts": [
        {
          "name": "market",
          "docs": [
            "🇪🇸 NOTA: `has_one` y `Signer` juntos equivalen a",
            "`require(msg.sender == market.authority)` de Solidity.",
            "Por separado no valen nada: `has_one` sin `Signer` dejaría que cualquiera",
            "pase la pubkey del authority sin demostrar que la controla."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.tokenMintA",
                "account": "marketAccount"
              },
              {
                "kind": "account",
                "path": "market.tokenMintB",
                "account": "marketAccount"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swapAToB",
      "docs": [
        "Swaps token A for token B at the market's fixed price."
      ],
      "discriminator": [
        57,
        5,
        83,
        157,
        173,
        236,
        126,
        96
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.tokenMintA",
                "account": "marketAccount"
              },
              {
                "kind": "account",
                "path": "market.tokenMintB",
                "account": "marketAccount"
              }
            ]
          }
        },
        {
          "name": "vaultA",
          "docs": [
            "🇪🇸 NOTA: estas `seeds` son lo que impide el account confusion. Anchor",
            "re-deriva la dirección desde market.key() y la compara. Pasar la bóveda",
            "de otro mercado aborta la instrucción. NO es el Signer quien lo detiene:",
            "el atacante firma legítimamente su propia transacción."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vaultB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userTokenA",
          "writable": true
        },
        {
          "name": "userTokenB",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swapBToA",
      "docs": [
        "Swaps token B for token A at the market's fixed price.",
        "",
        "🇪🇸 NOTA: es el espejo de swap_a_to_b, pero NO es copiar y pegar:",
        "· la bóveda que se drena es vault_a, no vault_b",
        "· el precio DIVIDE en vez de multiplicar, así que price = 0 es fatal",
        "· la entrada va a vault_b y la salida sale de vault_a"
      ],
      "discriminator": [
        171,
        201,
        74,
        104,
        102,
        128,
        36,
        162
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.tokenMintA",
                "account": "marketAccount"
              },
              {
                "kind": "account",
                "path": "market.tokenMintB",
                "account": "marketAccount"
              }
            ]
          }
        },
        {
          "name": "vaultA",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vaultB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userTokenA",
          "writable": true
        },
        {
          "name": "userTokenB",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "marketAccount",
      "discriminator": [
        201,
        78,
        187,
        225,
        240,
        198,
        201,
        251
      ]
    }
  ],
  "events": [
    {
      "name": "liquidityAdded",
      "discriminator": [
        154,
        26,
        221,
        108,
        238,
        64,
        217,
        161
      ]
    },
    {
      "name": "marketInitialized",
      "discriminator": [
        134,
        160,
        122,
        87,
        50,
        3,
        255,
        81
      ]
    },
    {
      "name": "priceSet",
      "discriminator": [
        152,
        186,
        196,
        72,
        117,
        210,
        36,
        160
      ]
    },
    {
      "name": "swapExecuted",
      "discriminator": [
        150,
        166,
        26,
        225,
        28,
        89,
        38,
        79
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "priceNotSet",
      "msg": "Price has not been set"
    },
    {
      "code": 6002,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity in vault"
    },
    {
      "code": 6003,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6004,
      "name": "zeroOutput",
      "msg": "Output amount is zero after truncation"
    },
    {
      "code": 6005,
      "name": "slippageExceeded",
      "msg": "Output below minimum requested"
    },
    {
      "code": 6006,
      "name": "mintOrder",
      "msg": "Mints must be in canonical order (mint_a < mint_b)"
    },
    {
      "code": 6007,
      "name": "unauthorized",
      "msg": "Only the market authority can perform this action"
    },
    {
      "code": 6008,
      "name": "invalidMint",
      "msg": "Token account does not match the market mint"
    }
  ],
  "types": [
    {
      "name": "liquidityAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketAccount",
      "docs": [
        "Market state. One account per token pair, addressed by a PDA.",
        "🇪🇸 NOTA: en Solidity esto sería `mapping(bytes32 => Market)` dentro del contrato.",
        "Aquí cada mercado es su propia cuenta y la dirección del PDA hace de índice."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Authority allowed to update the price. Per-market, not per-program."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "docs": [
              "Mint of token A. Canonical order guarantees token_mint_a < token_mint_b."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "Scaled by 10^PRICE_DECIMALS."
            ],
            "type": "u64"
          },
          {
            "name": "decimalsA",
            "docs": [
              "🇪🇸 NOTA: se leen del Mint al crear el mercado, NUNCA del caller."
            ],
            "type": "u8"
          },
          {
            "name": "decimalsB",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultABump",
            "type": "u8"
          },
          {
            "name": "vaultBBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "decimalsA",
            "type": "u8"
          },
          {
            "name": "decimalsB",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "priceSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "swapExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "aToB",
            "docs": [
              "true = A→B, false = B→A"
            ],
            "type": "bool"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
