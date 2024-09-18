import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-ledger'
import '@openzeppelin/hardhat-upgrades'

export const ledgerAccount = '0x23c4602e63ACfe29b930c530B19d44a84AF0d767'

const balance = '100000000000000000000000'
const accounts = [
  'c3381a96fa2be2aae2f2798e0887272e634417710aa09ecad9328754cdc8db8a', //0x11187eff852069a33d102476b2E8A9cc9167dAde
  '33a3d35ee3408a701f0ff775390ede800f728562ed656ec0036f9e4fd96e7d5b', //0x2228bdc8584595DfefA75597C96B13c00a2D88C2
  'fd52fbad9cb1258e30e6f83d1f2ecb2f6702887c1444d968133f41f3edb3f566', //0x33375555d73620FefD26cD083c425759a259FA18
  '73026645a77a51ebd812fd8780137f9b532a43cfadf379d1882dbfe5046bbff9', //0x444485D3d01447da706550B1c10362676193CAd0
  '73c8d46d8610c89d3f727fdd18099d9a142878bf5e010e65ba9382b8bb030b06', //0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67
  '630c184b1bb553100f94dc0dc8234b9334e0bf2e5595f83b1c494e09d5f5713a', //0xccc41e903D40e13bC87eE29413219d33a1161f72
  'd9afa4025b9a827bc0e1024e156283df7e4eb1fabf1dd9469b1912cb1bb1069c', //0x65079BB3f085240f1AFCBb3E4188afE93c194b84
  'c3b3b1292886ac39c82bcbfec23fc0e44f257c23d9d75292f382ee02dedb45b4', //0x777E071fE919B6e6b750B5384c92c4d782aD7A66
  'a4653ccf5fc796a2bcc08e23a0313633a6db853bd0f0d66e22c90aa9bfc601ca', //0x88896BE8690D9282201578242997dbAf1D26A2e6
  '757c2ba5f3d9cb431307c86bd9bb3cf2a39f3a6d07338889d7a166669b97b568', //0x99934B0838e8453e8F0E902E14C8C783abAAFCE8
  '5a824c92267488675e63330ab0a255d9d4bd470c6b60495fa74a52198813bdef', //0x10050810372A166386a402e317e8514C824c1fd1
  'bc165440269d4913fec4ebddc118e4dc37c38495e4f461356d6bed3e874507ab', //0x11036a1d893cF5B7b628619B94338D95d2a760cD
  'caca729573627e722ec6559635394afed37ffd979c81abe38d235f50cb4f7527', //0x1200364d8283e2B9a2E7904bbDd0C39cc757792B
  '35b197ee507093ce2329d53f76679a0cdf7030dda8c88b46d9a1e3f5d8e3d469', //0x1304C485F54541d86854F2aF061AA05EECd14d6D
]

const config: HardhatUserConfig = {
  defaultNetwork: 'localhost',
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    sepolia: {
      url: '',
      accounts,
    },
    'arbitrum-sepolia': {
      url: '',
      chainId: 421614,
      accounts,
    },
    mainnet: {
      url: '',
      ledgerAccounts: [ledgerAccount],
    },
    metis: {
      url: '',
      ledgerAccounts: [ledgerAccount],
    },
    testnet: {
      url: '',
      accounts,
    },
    hardhat: {
      chainId: 1337,
      accounts: accounts.map((acct) => ({ privateKey: acct, balance })),
      mining: {
        auto: true,
        interval: 5000,
      },
    },
  },
  etherscan: {
    apiKey: {
      metis: 'metis',
    },
    customChains: [
      {
        network: 'metis',
        chainId: 1088,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan',
          browserURL: 'https://andromeda-explorer.metis.io',
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  solidity: {
    compilers: [
      {
        version: '0.8.19',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 115,
          },
        },
      },
      {
        version: '0.7.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.11',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    overrides: {
      'contracts/metisStaking/SequencerVault.sol': {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 115,
          },
          viaIR: true,
        },
      },
      'contracts/metisStaking/test/SequencerVaultV2Mock.sol': {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 115,
          },
          viaIR: true,
        },
      },
    },
  },
}

export default config
