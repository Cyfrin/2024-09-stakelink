import {
  ERC20,
  ERC677,
  PriorityPool,
  SDLPoolPrimary,
  StakingPool,
} from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
} from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'

async function deploySequencerVCS() {
  const metisToken = (await getContract('METISToken')) as ERC20
  const stakingPool = (await getContract('METIS_StakingPool')) as StakingPool

  const sequencerVCS = await deployUpgradeable('StrategyMock', [
    metisToken.target,
    stakingPool.target,
    toEther(1000),
    toEther(10),
  ])
  console.log('SequencerVCS deployed: ', sequencerVCS.target)

  await (await stakingPool.addStrategy(sequencerVCS.target)).wait()

  updateDeployments(
    { METIS_SequencerVCS: sequencerVCS.target },
    { METIS_SequencerVCS: 'SequencerVCS' }
  )
}

// Wrapped stMETIS
const WrappedSDTokenArgs = {
  name: 'Wrapped stMETIS', // wrapped token name
  symbol: 'wstMETIS', // wrapped token symbol
}
// METIS Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked METIS', // METIS liquid staking token name
  derivativeTokenSymbol: 'stMETIS', // METIS liquid staking token symbol
  fees: [], // fee receivers & percentage amounts in basis points
}
// LINK Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}

export async function deployMETISStaking() {
  const { accounts } = await getAccounts()
  const sdlPoolPrimary = (await getContract('SDLPool')) as SDLPoolPrimary

  const metisToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Metis',
    'METIS',
    1000000,
  ])) as ERC677
  console.log('METISToken deployed: ', metisToken.target)

  const stakingPool = (await deployUpgradeable('StakingPool', [
    metisToken.target,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
  ])) as StakingPool
  console.log('METIS_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    metisToken.target,
    stakingPool.target,
    sdlPoolPrimary.target,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
  ])) as PriorityPool
  console.log('METIS_PriorityPool deployed: ', priorityPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.target)

  const stMetisSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPoolPrimary.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stMetis_SDLRewardsPool deployed: ', stMetisSDLRewardsPool.target)

  await (await stakingPool.addFee(stMetisSDLRewardsPool.target, 1000)).wait()
  await (await sdlPoolPrimary.addToken(stakingPool.target, stMetisSDLRewardsPool.target)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()

  updateDeployments(
    {
      METISToken: metisToken.target.toString(),
      METIS_StakingPool: stakingPool.target.toString(),
      METIS_PriorityPool: priorityPool.target.toString(),
      METIS_WrappedSDToken: wsdToken.target,
      stMETIS_SDLRewardsPool: stMetisSDLRewardsPool.target,
    },
    {
      METISToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      METIS_StakingPool: 'StakingPool',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
      stMETIS_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  await deploySequencerVCS()
}
