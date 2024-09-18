import { ethers } from 'hardhat'
import { ERC20, SDLPoolPrimary } from '../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
  deployImplementation,
} from '../../utils/deployment'
import { toEther } from '../../utils/helpers'

const sequencerRewardsCCIPSenderAddress = '' // address of contract deployed on Metis
const ccipRouterAddress = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D' // ETH mainnet CCIP router

// Wrapped stMETIS
const WrappedSDTokenArgs = {
  name: 'Wrapped stMETIS', // wrapped token name
  symbol: 'wstMETIS', // wrapped token symbol
}
// METIS Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked METIS', // METIS liquid staking token name
  derivativeTokenSymbol: 'stMETIS', // METIS liquid staking token symbol
  fees: [['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 300]], // fee receivers & percentage amounts in basis points
}
// Sequencer VCS
const SequencerVCSArgs = {
  lockingInfo: '0x0fe382b74C3894B65c10E5C12ae60Bbd8FAf5b48', // address of Metis locking info contract
  depositController: ethers.ZeroAddress, // address authorized to deposit queued tokens into vaults
  sdlPoolFee: 600, // basis point fee to be paid to SDL pool
  operatorRewardPercentage: 600, // basis point amount of an operator's earned rewards that they receive
}
// METIS Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}
// PP Distribution Oracle
const DistributionOracleArgs = {
  chainlinkOracle: '0x1152c76A0B3acC9856B1d8ee9EbDf2A2d0a01cC3', // address of Chainlink oracle contract
  jobId: ethers.ZeroHash, // adapter job ID
  fee: 0, // LINK fee for adpapter job
  minTimeBetweenUpdates: 86400, // min time between updates in seconds
  minDepositsSinceLastUpdate: toEther(15000), // min amount of deposits required to execute update
  minBlockConfirmations: 75, // min number of block confirmations between initiating update and executing
}

async function main() {
  const sdlPoolPrimary = (await getContract('SDLPool', true)) as SDLPoolPrimary
  const metisToken = (await getContract('METISToken', true)) as ERC20
  const linkToken = (await getContract('LINKToken', true)) as ERC20

  const stakingPool = await deployUpgradeable(
    'StakingPool',
    [
      metisToken.target,
      StakingPoolArgs.derivativeTokenName,
      StakingPoolArgs.derivativeTokenSymbol,
      StakingPoolArgs.fees,
    ],
    true
  )
  console.log('METIS_StakingPool deployed: ', stakingPool.target)

  const vaultImpAddress = (await deployImplementation('SequencerVault', true)) as string
  console.log('SequencerVault implementation deployed: ', vaultImpAddress)

  const sequencerVCS = await deployUpgradeable(
    'SequencerVCS',
    [
      metisToken.target,
      stakingPool.target,
      SequencerVCSArgs.lockingInfo,
      SequencerVCSArgs.depositController,
      vaultImpAddress,
      sequencerRewardsCCIPSenderAddress,
      [],
      SequencerVCSArgs.operatorRewardPercentage,
    ],
    true
  )
  console.log('METIS_SequencerVCS deployed: ', sequencerVCS.target)

  const rewardsReceiver = await deploy(
    'SequencerRewardsCCIPReceiver',
    [
      ccipRouterAddress,
      metisToken.target,
      sequencerVCS.target,
      stakingPool.target,
      sequencerRewardsCCIPSenderAddress,
    ],
    true
  )
  console.log('METIS_SequencerRewardsCCIPReceiver deployed: ', rewardsReceiver.target)

  const priorityPool = await deployUpgradeable(
    'PriorityPool',
    [
      metisToken.target,
      stakingPool.target,
      sdlPoolPrimary.target,
      PriorityPoolArgs.queueDepositMin,
      PriorityPoolArgs.queueDepositMax,
    ],
    true
  )
  console.log('METIS_PriorityPool deployed: ', priorityPool.target)

  const wsdToken = await deploy(
    'WrappedSDToken',
    [stakingPool.target, WrappedSDTokenArgs.name, WrappedSDTokenArgs.symbol],
    true
  )
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.target)

  const stMetisSDLRewardsPool = await deploy(
    'RewardsPoolWSD',
    [sdlPoolPrimary.target, stakingPool.target, wsdToken.target],
    true
  )
  console.log('stMetis_SDLRewardsPool deployed: ', stMetisSDLRewardsPool.target)

  const distributionOracle = await deploy(
    'DistributionOracle',
    [
      linkToken.target,
      DistributionOracleArgs.chainlinkOracle,
      DistributionOracleArgs.jobId,
      DistributionOracleArgs.fee,
      DistributionOracleArgs.minTimeBetweenUpdates,
      DistributionOracleArgs.minDepositsSinceLastUpdate,
      DistributionOracleArgs.minBlockConfirmations,
      priorityPool.target,
    ],
    true
  )
  console.log('METIS_PP_DistributionOracle deployed: ', distributionOracle.target)

  updateDeployments(
    {
      METIS_StakingPool: stakingPool.target,
      METIS_SequencerVCS: sequencerVCS.target,
      METIS_SequencerRewardsCCIPReceiver: rewardsReceiver.target,
      METIS_PriorityPool: priorityPool.target,
      METIS_WrappedSDToken: wsdToken.target,
      stMETIS_SDLRewardsPool: stMetisSDLRewardsPool.target,
      METIS_PP_DistributionOracle: distributionOracle.target,
    },
    {
      METIS_StakingPool: 'StakingPool',
      METIS_SequencerVCS: 'SequencerVCS',
      METIS_SequencerRewardsCCIPReceiver: 'SequencerRewardsCCIPReceiver',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
      stMETIS_SDLRewardsPool: 'RewardsPoolWSD',
      METIS_PP_DistributionOracle: 'DistributionOracle',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
