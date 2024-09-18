import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../../utils/helpers'
import {
  ERC677,
  SDLPoolMock,
  StakingPool,
  PriorityPool,
  StrategyMock,
  WithdrawalPool,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('PriorityPool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()
    await setupToken(token, accounts, true)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(1000),
      toEther(100),
    ])) as StrategyMock
    adrs.strategy = await strategy.getAddress()

    const sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock
    adrs.sdlPool = await sdlPool.getAddress()

    const pp = (await deployUpgradeable('PriorityPool', [
      adrs.token,
      adrs.stakingPool,
      adrs.sdlPool,
      toEther(100),
      toEther(1000),
    ])) as PriorityPool
    adrs.pp = await pp.getAddress()

    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      adrs.token,
      adrs.stakingPool,
      adrs.pp,
      toEther(10),
      0,
    ])) as WithdrawalPool
    adrs.withdrawalPool = await withdrawalPool.getAddress()

    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(adrs.pp)
    await stakingPool.setRebaseController(accounts[0])
    await pp.setDistributionOracle(accounts[0])
    await pp.setWithdrawalPool(adrs.withdrawalPool)

    for (let i = 0; i < signers.length; i++) {
      await token.connect(signers[i]).approve(adrs.pp, ethers.MaxUint256)
    }

    await pp.deposit(1000, false, ['0x'])

    return { signers, accounts, adrs, token, stakingPool, strategy, sdlPool, pp, withdrawalPool }
  }

  it('deposit should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, strategy, stakingPool } = await loadFixture(
      deployFixture
    )

    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 500)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500)

    await pp.connect(signers[2]).deposit(toEther(1000), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 500)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 500)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 500)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], 0)), 500)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9000)

    await strategy.setMaxDeposits(toEther(1600))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    await pp.connect(signers[3]).deposit(toEther(1000), false, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 100)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[3], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9900)

    await pp.connect(signers[4]).deposit(toEther(1000), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[4], 0)), 1000)
    assert.equal(fromEther(await token.balanceOf(accounts[4])), 9000)

    await pp.connect(signers[1]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[3]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[4]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[3]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[4]).deposit(toEther(10), true, ['0x'])

    assert.deepEqual(await pp.getAccounts(), [
      ethers.ZeroAddress,
      accounts[2],
      accounts[4],
      accounts[1],
      accounts[3],
    ])
    assert.equal(Number(await pp.getAccountIndex(accounts[0])), 0)
    assert.equal(Number(await pp.getAccountIndex(accounts[1])), 3)
    assert.equal(Number(await pp.getAccountIndex(accounts[2])), 1)
    assert.equal(Number(await pp.getAccountIndex(accounts[3])), 4)
    assert.equal(Number(await pp.getAccountIndex(accounts[4])), 2)

    await pp.setPoolStatus(2)
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWithCustomError(
      pp,
      'DepositsDisabled()'
    )
    await pp.setPoolStatus(1)
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWithCustomError(
      pp,
      'DepositsDisabled()'
    )
    await pp.setPoolStatus(0)
    await pp.pauseForUpdate()
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWith('Pausable: paused')
  })

  it('deposit should work correctly with queued withdrawals', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool } = await loadFixture(deployFixture)

    await stakingPool.approve(adrs.pp, ethers.MaxUint256)
    await pp.deposit(toEther(99), true, ['0x'])
    await pp.withdraw(toEther(20), 0, 0, [], false, true)
    await pp.connect(signers[1]).deposit(toEther(15), true, ['0x'])
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 15)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.withdrawalPool)), 5)
    assert.equal(fromEther(await token.balanceOf(adrs.withdrawalPool)), 15)

    await pp.connect(signers[1]).deposit(toEther(30), true, ['0x'])
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 45)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.withdrawalPool)), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.withdrawalPool)), 20)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { signers, adrs, pp, token, stakingPool, strategy } = await loadFixture(deployFixture)

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(3500))

    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3000)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(adrs.stakingPool, toEther(500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3500)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(adrs.stakingPool, toEther(200))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4000)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1300)
    assert.equal(fromEther(await pp.totalQueued()), 700)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(adrs.stakingPool, toEther(100))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4800)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(
      pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    ).to.be.revertedWithCustomError(pp, 'InsufficientDepositRoom()')
    await strategy.setMaxDeposits(toEther(4900))
    await expect(
      pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    ).to.be.revertedWithCustomError(pp, 'InsufficientQueuedTokens()')
    await pp.deposit(toEther(199), true, ['0x'])
    await strategy.setMaxDeposits(toEther(5000))
    await expect(
      pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    ).to.be.revertedWithCustomError(pp, 'InsufficientQueuedTokens()')
    await token.transfer(adrs.stakingPool, toEther(1))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.setPoolStatus(2)
    await expect(
      pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    ).to.be.revertedWithCustomError(pp, 'DepositsDisabled()')
    await pp.setPoolStatus(1)
    await expect(
      pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    ).to.be.revertedWithCustomError(pp, 'DepositsDisabled()')
  })

  it('checkUpkeep should work correctly', async () => {
    const { adrs, pp, token, strategy } = await loadFixture(deployFixture)

    await strategy.setMaxDeposits(0)
    await pp.deposit(toEther(1000), true, ['0x'])
    await strategy.setMaxDeposits(10)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await strategy.setMaxDeposits(toEther(1500))
    await pp.setQueueDepositParams(toEther(1001), toEther(2000))
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await token.transfer(adrs.stakingPool, toEther(1))
    await pp.setPoolStatus(2)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await pp.setPoolStatus(1)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await pp.setPoolStatus(0)
    assert.deepEqual(await pp.checkUpkeep('0x'), [
      true,
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [toEther(1001)]),
    ])
  })

  it('performUpkeep should work corectly', async () => {
    const { signers, adrs, pp, token, stakingPool, strategy } = await loadFixture(deployFixture)

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(3500))

    await pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3000)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(adrs.stakingPool, toEther(500))
    await pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3500)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(adrs.stakingPool, toEther(200))
    await pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4000)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 1300)
    assert.equal(fromEther(await pp.totalQueued()), 700)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(adrs.stakingPool, toEther(100))
    await pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4800)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(
      pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(pp, 'InsufficientDepositRoom()')
    await strategy.setMaxDeposits(toEther(4900))
    await expect(
      pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(pp, 'InsufficientQueuedTokens()')
    await pp.deposit(toEther(199), true, ['0x'])
    await strategy.setMaxDeposits(toEther(5000))
    await expect(
      pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(pp, 'InsufficientQueuedTokens()')
    await token.transfer(adrs.stakingPool, toEther(1))
    await pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))

    await pp.setPoolStatus(2)
    await expect(
      pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(pp, 'DepositsDisabled()')
    await pp.setPoolStatus(1)
    await expect(
      pp.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(pp, 'DepositsDisabled()')
  })

  it('getAccountData should work correctly', async () => {
    const { signers, accounts, pp, sdlPool } = await loadFixture(deployFixture)

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await sdlPool.setEffectiveBalance(accounts[0], toEther(1000))
    await sdlPool.setEffectiveBalance(accounts[1], toEther(400))
    await sdlPool.setEffectiveBalance(accounts[2], toEther(300))

    let data = await pp.getAccountData()
    assert.deepEqual(data[0], [ethers.ZeroAddress, accounts[0], accounts[1], accounts[2]])
    assert.deepEqual(
      data[1].map((v: any) => fromEther(v)),
      [0, 1000, 400, 300]
    )
    assert.deepEqual(
      data[2].map((v: any) => fromEther(v)),
      [0, 1000, 500, 500]
    )

    await pp.connect(signers[3]).deposit(toEther(100), true, ['0x'])
    await sdlPool.setEffectiveBalance(accounts[0], toEther(150))

    data = await pp.getAccountData()
    assert.deepEqual(data[0], [
      ethers.ZeroAddress,
      accounts[0],
      accounts[1],
      accounts[2],
      accounts[3],
    ])
    assert.deepEqual(
      data[1].map((v: any) => fromEther(v)),
      [0, 150, 400, 300, 0]
    )
    assert.deepEqual(
      data[2].map((v: any) => fromEther(v)),
      [0, 1000, 500, 500, 100]
    )
  })

  it('updateDistribution should work correctly', async () => {
    const { signers, adrs, pp, token, stakingPool, strategy } = await loadFixture(deployFixture)

    await pp.deposit(toEther(2000), true, ['0x'])
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2500))
    await pp.depositQueuedTokens(toEther(0), toEther(10000), ['0x'])

    await expect(
      pp.updateDistribution(ethers.encodeBytes32String(''), ethers.encodeBytes32String(''), 0, 0)
    ).to.be.revertedWith('Pausable: not paused')

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      ethers.encodeBytes32String('root'),
      ethers.encodeBytes32String('ipfs'),
      toEther(400),
      toEther(200)
    )

    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [100, 50]
    )
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String('root'))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String('ipfs'))
    assert.equal(await pp.paused(), false)

    await strategy.setMaxDeposits(toEther(4000))
    await pp.depositQueuedTokens(toEther(0), toEther(10000), ['0x'])
    await pp.pauseForUpdate()
    await pp.updateDistribution(
      ethers.encodeBytes32String('root2'),
      ethers.encodeBytes32String('ipfs2'),
      toEther(1600),
      toEther(800)
    )

    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String('root2'))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String('ipfs2'))
    assert.equal(await pp.paused(), false)
  })

  it('claimLSDTokens should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(1500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      pp.claimLSDTokens(toEther(301), toEther(300), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.claimLSDTokens(toEther(300), toEther(301), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.claimLSDTokens(toEther(300), toEther(300), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.connect(signers[1]).claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')

    assert.equal(fromEther(await pp.getLSDTokens(accounts[0], data[1][2])), 300)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[0], data[1][1])), 700)

    await pp.claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 1300)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[0], data[1][2])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[0], data[1][1])), 700)

    await token.transfer(adrs.strategy, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await pp.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 300)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 350)

    await expect(
      pp.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'NothingToClaim()')
  })

  it('unqueueTokens should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(1500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await expect(pp.unqueueTokens(toEther(1501), 0, 0, [])).to.be.revertedWithCustomError(
      pp,
      'InsufficientQueuedTokens()'
    )

    await pp.connect(signers[1]).unqueueTokens(toEther(100), 0, 0, [])
    assert.equal(fromEther(await pp.totalQueued()), 1400)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 400)

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(151), toEther(150), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(151), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')

    await pp
      .connect(signers[1])
      .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await pp.totalQueued()), 1350)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9650)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 150)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 200)

    await expect(
      pp.connect(signers[2]).unqueueTokens(toEther(500), toEther(50), toEther(50), tree.getProof(3))
    ).to.be.revertedWithCustomError(pp, 'InsufficientBalance()')

    await pp
      .connect(signers[2])
      .unqueueTokens(toEther(450), toEther(50), toEther(50), tree.getProof(3))
    assert.equal(fromEther(await pp.totalQueued()), 900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[2], data[3][2])), 50)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], data[3][1])), 0)

    await token.transfer(adrs.strategy, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await pp
      .connect(signers[1])
      .unqueueTokens(toEther(100), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await pp.totalQueued()), 800)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9750)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 300)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 100)

    await pp.connect(signers[3]).deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[3]).unqueueTokens(toEther(50), 0, 0, [])
    assert.equal(fromEther(await pp.totalQueued()), 850)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[3], 0)), 50)
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await stakingPool.connect(signers[1]).approve(adrs.pp, ethers.MaxUint256)
    await stakingPool.connect(signers[2]).approve(adrs.pp, ethers.MaxUint256)
    await pp.connect(signers[1]).deposit(toEther(2000), true, ['0x'])
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(100), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2700))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.pauseForUpdate()
    await pp.connect(signers[1]).withdraw(toEther(10), 0, 0, [], false, false)

    assert.equal(fromEther(await pp.totalQueued()), 490)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [710, 355]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2700)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8010)

    await pp.updateDistribution(
      ethers.encodeBytes32String(''),
      ethers.encodeBytes32String('ipfs'),
      toEther(700),
      toEther(350)
    )
    await expect(
      pp.connect(signers[1]).withdraw(toEther(500), 0, 0, [], false, false)
    ).to.be.revertedWithCustomError(pp, 'InsufficientLiquidity()')

    await pp.connect(signers[1]).withdraw(toEther(600), 0, 0, [], false, true)

    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [500, 250]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2700)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8500)
  })

  it('withdraw should work correctly with queued withdrawals', async () => {
    const { adrs, pp, token, stakingPool, strategy, withdrawalPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.approve(adrs.pp, ethers.MaxUint256)
    await pp.deposit(toEther(100), true, ['0x'])
    await pp.withdraw(toEther(50), 0, 0, [], true, true)
    await strategy.setMinDeposits(0)
    await pp.withdraw(toEther(10), 0, 0, [], true, true)

    assert.equal(fromEther(await stakingPool.balanceOf(adrs.withdrawalPool)), 60)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 60)
    assert.equal(fromEther(await token.balanceOf(adrs.withdrawalPool)), 0)
  })

  it('withdraw should work correctly with queued tokens', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await stakingPool.connect(signers[1]).approve(adrs.pp, ethers.MaxUint256)
    await stakingPool.connect(signers[2]).approve(adrs.pp, ethers.MaxUint256)
    await pp.deposit(toEther(1000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(200), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2150))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.pauseForUpdate()
    await expect(
      pp.connect(signers[1]).withdraw(toEther(10), toEther(1), 0, [], true, false)
    ).to.be.revertedWith('Pausable: paused')

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(0), toEther(0)],
      [accounts[1], toEther(50), toEther(50)],
      [accounts[2], toEther(100), toEther(100)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(150),
      toEther(75)
    )
    await pp
      .connect(signers[1])
      .withdraw(toEther(50), toEther(50), toEther(50), tree.getProof(2), true, false)

    assert.equal(fromEther(await pp.totalQueued()), 100)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2150)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], toEther(50))), 0)

    await expect(
      pp
        .connect(signers[2])
        .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(2), true, false)
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.connect(signers[2]).withdraw(toEther(150), 0, 0, [], true, false)
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await stakingPool.transfer(accounts[2], toEther(100))
    await pp
      .connect(signers[2])
      .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(3), true, true)

    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2150)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9900)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], toEther(100))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 50)
  })

  it('canWithdraw should work correctly', async () => {
    const { accounts, pp, strategy } = await loadFixture(deployFixture)

    await strategy.setMinDeposits(0)
    await pp.deposit(toEther(2000), true, ['0x'])
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 2000)
    await strategy.setMaxDeposits(toEther(1100))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 1900)
    await pp.pauseForUpdate()
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 1000)
  })

  it('onTokenTransfer should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool } = await loadFixture(deployFixture)

    await expect(
      pp.onTokenTransfer(
        accounts[0],
        1000,
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    ).to.be.revertedWithCustomError(pp, 'UnauthorizedToken()')
    await expect(
      token.transferAndCall(
        adrs.pp,
        0,
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    ).to.be.revertedWithCustomError(pp, 'InvalidValue()')

    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.pp,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, ['0x']])
      )
    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.pp,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, ['0x']])
      )

    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000)
    assert.equal(fromEther(await pp.totalQueued()), 0)

    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.pp,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 7000)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 2000)

    await stakingPool
      .connect(signers[1])
      .transferAndCall(
        adrs.pp,
        toEther(100),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, ['0x']])
      )
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 900)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 1900)
  })

  it('executeQueuedWithdrawals should work correctly', async () => {
    const { adrs, pp, token, stakingPool, strategy, withdrawalPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.approve(adrs.pp, ethers.MaxUint256)
    await pp.deposit(toEther(1100), true, ['0x'])
    await pp.withdraw(toEther(950), 0, 0, [], false, true)
    await strategy.setMinDeposits(toEther(200))

    await withdrawalPool.performUpkeep(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
    )

    assert.equal(fromEther(await stakingPool.balanceOf(adrs.withdrawalPool)), 50)
    assert.equal(fromEther(await token.balanceOf(adrs.withdrawalPool)), 800)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.pp)), 100)
    assert.equal(fromEther(await token.balanceOf(adrs.pp)), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 200)
  })
})
