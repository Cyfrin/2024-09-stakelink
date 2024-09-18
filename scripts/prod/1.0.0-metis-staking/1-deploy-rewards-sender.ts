import { ethers } from 'hardhat'
import axios from 'axios'
import { updateDeployments, getContract, deployUpgradeable, deploy } from '../../utils/deployment'

// Deploy on Metis

async function switchNetwork(chainId: number, host: string): Promise<void> {
  const chainIdHex = `0x${chainId.toString(16)}`
  const params = [
    {
      chainId: chainIdHex,
    },
  ]

  try {
    const response = await axios.post(`http://${host}:1248`, {
      jsonrpc: '2.0',
      method: 'wallet_switchEthereumChain',
      params: params,
      id: 1,
    })

    if (response.status !== 200) {
      throw new Error(`Failed to switch network: ${response.statusText}`)
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorText = error.response?.data || error.message
      throw new Error(`Failed to switch network: ${errorText}`)
    } else {
      throw error
    }
  }
}

// wstMETIS
const wstMETIS = {
  name: 'Wrapped stMETIS',
  symbol: 'wstMETIS',
  decimals: 18,
}

// Sequencer Rewards CCIP Sender
const RewardsSenderArgs = {
  router: ethers.ZeroAddress, // address of CCIP router on Metis
  transferInitiator: ethers.ZeroAddress, // address authorized to initiate rewards transfers
  destinationChainSelector: '5009297550715157269', // ETH mainnet CCIP ID
  extraArgs: '0x', // extra args for reward token CCIP transfer
}

async function main() {
  await switchNetwork(1088, '')

  const metisToken = await getContract('METISToken')

  const rewardsSender = await deployUpgradeable(
    'SequencerRewardsCCIPSender',
    [
      RewardsSenderArgs.router,
      ethers.ZeroAddress,
      await metisToken.getAddress(),
      RewardsSenderArgs.transferInitiator,
      RewardsSenderArgs.destinationChainSelector,
      RewardsSenderArgs.extraArgs,
    ],
    true
  )
  console.log('METIS_SequencerRewardsCCIPSender deployed: ', await rewardsSender.getAddress())

  const wrappedSDToken = await deploy(
    'BurnMintERC677',
    [wstMETIS.name, wstMETIS.symbol, wstMETIS.decimals, 0],
    true
  )
  console.log('METIS_WrappedSDToken deployed: ', await wrappedSDToken.getAddress())

  updateDeployments(
    {
      METIS_SequencerRewardsCCIPSender: await rewardsSender.getAddress(),
      METIS_WrappedSDToken: await wrappedSDToken.getAddress(),
    },
    {
      METIS_SequencerRewardsCCIPSender: 'SequencerRewardsCCIPSender',
      METIS_WrappedSDToken: 'BurnMintERC677',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
