import { getAccounts, toEther } from '../utils/helpers'
import {
  getContract,
  deployUpgradeable,
  deploy,
  updateDeployments,
  printDeployments,
} from '../utils/deployment'
import {
  LPLMigration,
  StakingAllowance,
  StakingPool,
  ERC677,
  StrategyMock,
  PriorityPool,
  DelegatorPool,
  CurveMock,
  SDLPoolPrimary,
  ERC20,
} from '../../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - holds no tokens
2 - holds SDL/LPL/LINK/METIS + has staked LPL + has PoolOwners LINK rewards
3 - holds SDL/LPL/LINK/METIS + stSDL/stLINK + has DelegatorPool stLINK rewards 
4 - holds SDL/LPL/LINK/METIS + stLINK + has queued LINK + has withdrawable stLINK in the queue
5 - holds SDL/LPL/LINK/METIS + reSDL + has queued LINK + has SDLPool stLINK rewards
6 - holds SDL/LPL/LINK/METIS + reSDL (locked) + has queued LINK + has withdrawable stLINK in the queue 
7 - holds SDL/LPL/LINK/METIS + has queued LINK 
8 - holds SDL/LPL/LINK/METIS + stLINK + has queued LINK + cannot withdraw full queued LINK amount 
*/

/*
Staking Queue IPFS mock data
CID: QmV1N49KT7at9LpNxyyPnCNBLEztMFHvLXoHpdPRoUzGgz
data:
{
  "merkleRoot": "0x52171b32a0a6c33f6756c5c33673790b66945c4f1c4ec4a81932e60b06b5a321",
  "data": {
    "0x0000000000000000000000000000000000000000": {
      "amount": "0",
      "sharesAmount": "0"
    },
    "0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67": {
      "amount": "50000000000000000000",
      "sharesAmount": "25000000000000000000"
    },
    "0xccc41e903D40e13bC87eE29413219d33a1161f72": {
      "amount": "0",
      "sharesAmount": "0"
    },
    "0x65079BB3f085240f1AFCBb3E4188afE93c194b84": {
      "amount": "150000000000000000000",
      "sharesAmount": "75000000000000000000"
    }
  }
}
*/

async function main() {
  const { signers, accounts } = await getAccounts()
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration
  const LINK_StakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const linkToken = (await getContract('LINKToken')) as ERC677
  const LINK_PriorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const lplToken = (await getContract('LPLToken')) as ERC677

  const poolOwnersV1 = (await getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await getContract('LINK_OwnersRewardsPoolV1')) as any
  const sdlPool = (await getContract('SDLPool')) as SDLPoolPrimary

  const METISToken = (await getContract('METISToken')) as ERC20
  const METIS_StakingPool = (await getContract('METIS_StakingPool')) as StakingPool
  const METIS_PriorityPool = (await getContract('METIS_PriorityPool')) as PriorityPool
  const strategyMockMETIS = (await ethers.getContractAt(
    'StrategyMock',
    (
      await METIS_StakingPool.getStrategies()
    )[0]
  )) as StrategyMock

  // LPL migration

  let tx = await sdlToken.mint(lplMigration.target, toEther(100000))
  await tx.wait()

  // LINK Staking

  await (await LINK_StakingPool.removeStrategy(0, '0x')).wait()
  await (await LINK_StakingPool.removeStrategy(0, '0x')).wait()

  const strategyMockLINK = (await deployUpgradeable('StrategyMock', [
    linkToken.target,
    LINK_StakingPool.target,
    toEther(1000),
    toEther(10),
  ])) as StrategyMock
  tx = await LINK_StakingPool.addStrategy(strategyMockLINK.target)
  await tx.wait()
  tx = await LINK_PriorityPool.setDistributionOracle(accounts[0])
  await tx.wait()

  let stLINK_DelegatorRewardsPool = await deploy('RewardsPool', [
    delegatorPool.target,
    LINK_StakingPool.target,
  ])
  tx = await delegatorPool.addToken(LINK_StakingPool.target, stLINK_DelegatorRewardsPool.target)
  await tx.wait()

  updateDeployments(
    {
      stLINK_DelegatorRewardsPool: stLINK_DelegatorRewardsPool.target,
    },
    {
      stLINK_DelegatorRewardsPool: 'RewardsPool',
    }
  )
  // Basic Curve Mock

  const curveMock = (await deploy('CurveMock', [
    LINK_StakingPool.target,
    linkToken.target,
  ])) as CurveMock
  tx = await linkToken.transfer(curveMock.target, toEther(1000))
  await tx.wait()

  updateDeployments({
    CurvePool: curveMock.target.toString(),
  })

  // Accounts

  for (let i = 2; i < accounts.length; i++) {
    tx = await sdlToken.mint(accounts[i], toEther(10000))
    await tx.wait()
    tx = await lplToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await linkToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await METISToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
  }

  tx = await linkToken.transferAndCall(
    LINK_PriorityPool.target,
    toEther(500),
    ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [false])
  )
  await (await METISToken.approve(METIS_PriorityPool.target, ethers.MaxUint256)).wait()
  await (await METIS_PriorityPool.deposit(toEther(500), false)).wait()

  // Account 2

  tx = await lplToken.connect(signers[2]).transferAndCall(poolOwnersV1.target, toEther(10), '0x')
  await tx.wait()
  tx = await linkToken.transfer(ownersRewardsPoolV1.target, toEther(10))
  await tx.wait()
  tx = await ownersRewardsPoolV1.distributeRewards()
  await tx.wait()

  // stSDL

  // Account 3
  tx = await sdlToken.connect(signers[3]).transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  // Account 9
  tx = await sdlToken.connect(signers[9]).transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  // Account 10
  tx = await sdlToken
    .connect(signers[10])
    .transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  // Account 11
  tx = await sdlToken
    .connect(signers[11])
    .transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  // Account 12
  tx = await sdlToken
    .connect(signers[12])
    .transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  // Account 13
  tx = await sdlToken
    .connect(signers[13])
    .transferAndCall(delegatorPool.target, toEther(1000), '0x')
  await tx.wait()

  tx = await linkToken
    .connect(signers[3])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [false])
    )
  await tx.wait()
  await (
    await METISToken.connect(signers[3]).approve(METIS_PriorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await METIS_PriorityPool.connect(signers[3]).deposit(toEther(100), false)).wait()

  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(delegatorPool.target, toEther(100), '0x')
  await tx.wait()
  tx = await delegatorPool.retireDelegatorPool([], sdlPool.target)
  await tx.wait()

  // Account 4

  tx = await linkToken
    .connect(signers[4])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(500),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
    )
  await tx.wait()
  await (
    await METISToken.connect(signers[4]).approve(METIS_PriorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await METIS_PriorityPool.connect(signers[4]).deposit(toEther(500), true)).wait()

  // Account 5

  tx = await sdlToken
    .connect(signers[5])
    .transferAndCall(
      sdlPool.target,
      toEther(2000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
  await tx.wait()

  tx = await linkToken
    .connect(signers[5])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(200),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
    )
  await (
    await METISToken.connect(signers[5]).approve(METIS_PriorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await METIS_PriorityPool.connect(signers[5]).deposit(toEther(200), true)).wait()

  // Account 6

  tx = await sdlToken
    .connect(signers[6])
    .transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
  await tx.wait()
  tx = await linkToken
    .connect(signers[6])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(300),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
    )
  await tx.wait()
  await (
    await METISToken.connect(signers[6]).approve(METIS_PriorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await METIS_PriorityPool.connect(signers[6]).deposit(toEther(300), true)).wait()

  // Reward Distributions

  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(sdlPool.target, toEther(50), '0x')
  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(sdlPool.target, toEther(50), '0x')
  await tx.wait()
  await (await METIS_StakingPool.transferAndCall(sdlPool.target, toEther(50), '0x')).wait()
  await (await METIS_StakingPool.transferAndCall(sdlPool.target, toEther(50), '0x')).wait()

  tx = await linkToken.transfer(strategyMockLINK.target, toEther(500))
  await tx.wait()

  await LINK_StakingPool.setRebaseController(accounts[0])
  tx = await LINK_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()
  tx = await linkToken.transfer(strategyMockLINK.target, toEther(500))
  await tx.wait()
  tx = await LINK_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()

  tx = await METISToken.transfer(strategyMockMETIS.target, toEther(500))
  await tx.wait()

  await METIS_StakingPool.setRebaseController(accounts[0])
  tx = await METIS_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()
  tx = await METISToken.transfer(strategyMockMETIS.target, toEther(500))
  await tx.wait()
  tx = await METIS_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()

  // Staking Queue

  tx = await strategyMockLINK.setMaxDeposits(toEther(2200))
  await tx.wait()

  tx = await LINK_PriorityPool.depositQueuedTokens(toEther(0), toEther(10000))
  await tx.wait()

  tx = await LINK_PriorityPool.pauseForUpdate()
  await tx.wait()
  tx = await LINK_PriorityPool.updateDistribution(
    '0x52171b32a0a6c33f6756c5c33673790b66945c4f1c4ec4a81932e60b06b5a321',
    '0x6310F1189600F807FAC771D10706B6665628B99797054447F58F4C8A05971B83',
    toEther(200),
    toEther(100)
  )
  await tx.wait()

  tx = await strategyMockMETIS.setMaxDeposits(toEther(2200))
  await tx.wait()

  tx = await METIS_PriorityPool.depositQueuedTokens(toEther(0), toEther(10000))
  await tx.wait()

  tx = await METIS_PriorityPool.pauseForUpdate()
  await tx.wait()
  tx = await METIS_PriorityPool.updateDistribution(
    '0x52171b32a0a6c33f6756c5c33673790b66945c4f1c4ec4a81932e60b06b5a321',
    '0x6310F1189600F807FAC771D10706B6665628B99797054447F58F4C8A05971B83',
    toEther(200),
    toEther(100)
  )
  await tx.wait()

  // Account 7

  tx = await linkToken
    .connect(signers[7])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
    )
  await tx.wait()

  // Account 8

  tx = await LINK_StakingPool.transfer(accounts[8], toEther(100))
  await tx.wait()
  tx = await linkToken
    .connect(signers[8])
    .transferAndCall(
      LINK_PriorityPool.target,
      toEther(5000),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
    )
  await tx.wait()

  tx = await strategyMockLINK.setMaxDeposits(toEther(6200))
  await tx.wait()
  tx = await LINK_PriorityPool.depositQueuedTokens(toEther(0), toEther(100000))
  await tx.wait()

  const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
  const vestingDuration = 4 * 365 * 86400 // 4 years

  let vesting0 = await deploy('Vesting', [accounts[0], accounts[12], vestingStart, vestingDuration])
  let vesting1 = await deploy('Vesting', [accounts[0], accounts[13], vestingStart, vestingDuration])

  await sdlToken.mint(vesting0.target, toEther(10000))
  await sdlToken.mint(vesting1.target, toEther(10000))

  updateDeployments(
    {
      SDL_Vesting_NOP_0: vesting0.target,
      SDL_Vesting_NOP_1: vesting1.target,
    },
    {
      SDL_Vesting_NOP0: 'Vesting',
      SDL_Vesting_NOP1: 'Vesting',
    }
  )

  printDeployments()

  console.log('setup-test-env-ready')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
