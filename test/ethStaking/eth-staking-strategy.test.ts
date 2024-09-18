import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  padBytes,
  concatBytes,
} from '../utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorController,
  NWLOperatorController,
  OperatorWhitelistMock,
  RewardsPool,
  RewardsReceiver,
  ERC677ReceiverMock,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const depositAmount = '0x0040597307000000'

const nwlOps = {
  keys: [padBytes('0xa1', 48), padBytes('0xa2', 48)],
  signatures: [padBytes('0xb1', 96), padBytes('0xb2', 96)],
}

const wlOps = {
  keys: [padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)],
  signatures: [padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)],
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('EthStakingStrategy', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const wETH = (await deploy('WrappedETH')) as WrappedETH
    adrs.wETH = await wETH.getAddress()

    const erc677Receiver = (await deploy('ERC677ReceiverMock')) as ERC677ReceiverMock
    adrs.erc677Receiver = await erc677Receiver.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.wETH,
      'LinkPool ETH',
      'lplETH',
      [
        [accounts[4], 1000],
        [adrs.erc677Receiver, 2000],
      ],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const wsdToken = (await deploy('WrappedSDToken', [
      adrs.stakingPool,
      'Wrapped LinkPool ETH',
      'wlplETH',
    ])) as WrappedSDToken
    adrs.wsdToken = await wsdToken.getAddress()

    const depositContract = (await deploy('DepositContract')) as DepositContract
    adrs.depositContract = await depositContract.getAddress()

    const strategy = (await deployUpgradeable('EthStakingStrategy', [
      adrs.wETH,
      adrs.stakingPool,
      toEther(1000),
      toEther(10),
      adrs.depositContract,
      withdrawalCredentials,
      1000,
    ])) as EthStakingStrategy
    adrs.strategy = await strategy.getAddress()

    await strategy.setBeaconOracle(accounts[0])

    const nwlOperatorController = (await deployUpgradeable('NWLOperatorController', [
      adrs.strategy,
      adrs.stakingPool,
    ])) as NWLOperatorController
    adrs.nwlOperatorController = await nwlOperatorController.getAddress()

    await nwlOperatorController.setKeyValidationOracle(accounts[0])
    await nwlOperatorController.setBeaconOracle(accounts[0])

    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    const wlOperatorController = (await deployUpgradeable('WLOperatorController', [
      adrs.strategy,
      adrs.stakingPool,
      await operatorWhitelist.getAddress(),
      2,
    ])) as WLOperatorController
    adrs.wlOperatorController = await wlOperatorController.getAddress()

    await wlOperatorController.setKeyValidationOracle(accounts[0])
    await wlOperatorController.setBeaconOracle(accounts[0])

    const nwlRewardsPool = (await deploy('RewardsPoolWSD', [
      adrs.nwlOperatorController,
      adrs.stakingPool,
      adrs.wsdToken,
    ])) as RewardsPool
    adrs.nwlRewardsPool = await nwlRewardsPool.getAddress()

    const wlRewardsPool = (await deploy('RewardsPoolWSD', [
      adrs.wlOperatorController,
      adrs.stakingPool,
      adrs.wsdToken,
    ])) as RewardsPool
    adrs.wlRewardsPool = await wlRewardsPool.getAddress()

    await nwlOperatorController.setRewardsPool(adrs.nwlRewardsPool)
    await wlOperatorController.setRewardsPool(adrs.wlRewardsPool)

    for (let i = 0; i < 5; i++) {
      await nwlOperatorController.addOperator('test')
      await nwlOperatorController.addKeyPairs(
        i,
        2,
        concatBytes(nwlOps.keys),
        concatBytes(nwlOps.signatures),
        {
          value: toEther(16 * 2),
        }
      )
      await wlOperatorController.addOperator('test')
      await wlOperatorController.addKeyPairs(
        i,
        3,
        concatBytes(wlOps.keys),
        concatBytes(wlOps.signatures)
      )

      if (i % 2 == 0) {
        await nwlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    const rewardsReceiver = (await deploy('RewardsReceiver', [
      adrs.strategy,
      toEther(4),
      toEther(5),
    ])) as RewardsReceiver
    adrs.rewardsReceiver = await rewardsReceiver.getAddress()

    async function stake(amount: number) {
      await wETH.wrap({ value: toEther(amount) })
      await stakingPool.deposit(accounts[0], toEther(amount), ['0x'])
    }

    await strategy.setNWLOperatorController(adrs.nwlOperatorController)
    await strategy.setWLOperatorController(adrs.wlOperatorController)
    await strategy.setDepositController(accounts[0])
    await strategy.setRewardsReceiver(adrs.rewardsReceiver)
    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await wETH.approve(adrs.stakingPool, ethers.MaxUint256)

    return {
      signers,
      accounts,
      adrs,
      wETH,
      erc677Receiver,
      stakingPool,
      wsdToken,
      depositContract,
      strategy,
      nwlOperatorController,
      wlOperatorController,
      nwlRewardsPool,
      wlRewardsPool,
      rewardsReceiver,
      stake,
    }
  }

  it('should be able to deposit into strategy', async () => {
    const { adrs, wETH, strategy, stake } = await loadFixture(deployFixture)

    await stake(2)
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 2, 'strategy balance incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 2, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await strategy.bufferedETH()), 2)
  })

  it('should not be able to withdraw from strategy', async () => {
    const { accounts, stakingPool, stake } = await loadFixture(deployFixture)

    await stake(2)
    await expect(
      stakingPool.withdraw(accounts[0], accounts[0], toEther(1), ['0x'])
    ).to.be.revertedWith('Not enough liquidity available to withdraw')
  })

  it('depositEther should work correctly', async () => {
    const {
      adrs,
      wETH,
      strategy,
      depositContract,
      nwlOperatorController,
      wlOperatorController,
      stake,
    } = await loadFixture(deployFixture)

    await stake(1000)
    await strategy.depositEther(5, 0, [], [])

    let keys = [...nwlOps.keys, ...nwlOps.keys, nwlOps.keys[0]]
    let signatures = [...nwlOps.signatures, ...nwlOps.signatures, nwlOps.signatures[0]]
    let events = await depositContract.queryFilter(depositContract.filters.DepositEvent())
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 920, 'strategy balance incorrect')
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.depositContract)),
      160,
      'deposit contract balance incorrect'
    )
    assert.equal(Number(await strategy.depositedValidators()), 5, 'depositedValidators incorrect')
    assert.equal(Number(await nwlOperatorController.queueLength()), 1, 'nwl queueLength incorrect')
    assert.equal(Number(await wlOperatorController.queueLength()), 9, 'wl queueLength incorrect')
    assert.equal(fromEther(await strategy.bufferedETH()), 920)

    await strategy.depositEther(1, 4, [0, 2], [2, 2])

    keys = [nwlOps.keys[1], wlOps.keys[0], wlOps.keys[1], wlOps.keys[0], wlOps.keys[1]]
    signatures = [
      nwlOps.signatures[1],
      wlOps.signatures[0],
      wlOps.signatures[1],
      wlOps.signatures[0],
      wlOps.signatures[1],
    ]
    events = (await depositContract.queryFilter(depositContract.filters.DepositEvent())).slice(5)
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 776, 'strategy balance incorrect')
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.depositContract)),
      320,
      'deposit contract balance incorrect'
    )
    assert.equal(Number(await strategy.depositedValidators()), 10, 'depositedValidators incorrect')
    assert.equal(Number(await nwlOperatorController.queueLength()), 0, 'nwl queueLength incorrect')
    assert.equal(Number(await wlOperatorController.queueLength()), 5, 'wl queueLength incorrect')
    assert.equal(fromEther(await strategy.bufferedETH()), 776)

    await strategy.depositEther(0, 4, [4, 0, 2], [2, 1, 1])

    keys = [wlOps.keys[0], wlOps.keys[1], wlOps.keys[2], wlOps.keys[2]]
    signatures = [
      wlOps.signatures[0],
      wlOps.signatures[1],
      wlOps.signatures[2],
      wlOps.signatures[2],
    ]
    events = (await depositContract.queryFilter(depositContract.filters.DepositEvent())).slice(10)
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 648, 'strategy balance incorrect')
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.depositContract)),
      448,
      'deposit contract balance incorrect'
    )
    assert.equal(Number(await strategy.depositedValidators()), 14, 'depositedValidators incorrect')
    assert.equal(Number(await nwlOperatorController.queueLength()), 0, 'nwl queueLength incorrect')
    assert.equal(Number(await wlOperatorController.queueLength()), 1, 'wl queueLength incorrect')
    assert.equal(fromEther(await strategy.bufferedETH()), 648)
  })

  it('depositEther validation should work correctly', async () => {
    const { signers, strategy, stake } = await loadFixture(deployFixture)

    await stake(100)

    await expect(strategy.connect(signers[1]).depositEther(1, 0, [], [])).to.be.revertedWith(
      'Sender is not deposit controller'
    )
    await expect(strategy.depositEther(0, 0, [], [])).to.be.revertedWith('Cannot deposit 0')
    await expect(strategy.depositEther(6, 4, [0, 2], [2, 2])).to.be.revertedWith(
      'Insufficient balance for deposit'
    )
    await expect(strategy.depositEther(0, 2, [0], [2])).to.be.revertedWith(
      'Non-whitelisted queue must be empty to assign whitelisted'
    )
  })

  it('reportBeaconState should work correctly', async () => {
    const { strategy, stake } = await loadFixture(deployFixture)

    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(90), toEther(0))

    assert.equal(Number(await strategy.beaconValidators()), 3, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 90, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.getDepositChange()), -6, 'depositChange incorrect')

    await strategy.reportBeaconState(4, toEther(132), toEther(0))

    assert.equal(Number(await strategy.beaconValidators()), 4, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 132, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.getDepositChange()), 4, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(163), toEther(2))

    assert.equal(Number(await strategy.beaconValidators()), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 163, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.getDepositChange()), 5, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(155), toEther(2))

    assert.equal(Number(await strategy.beaconValidators()), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 155, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.getDepositChange()), -3, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(156), toEther(1))

    assert.equal(Number(await strategy.beaconValidators()), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 156, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.getDepositChange()), -3, 'depositChange incorrect')
  })

  it('reportBeaconState validation should work correctly', async () => {
    const { signers, strategy, stake } = await loadFixture(deployFixture)

    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(90), toEther(0))

    await expect(
      strategy.connect(signers[1]).reportBeaconState(4, toEther(90), toEther(0))
    ).to.be.revertedWith('Sender is not beacon oracle')
    await expect(strategy.reportBeaconState(9, toEther(90), toEther(0))).to.be.revertedWith(
      'Reported more validators than deposited'
    )
    await expect(strategy.reportBeaconState(2, toEther(90), toEther(0))).to.be.revertedWith(
      'Reported less validators than tracked'
    )
  })

  it('updateDeposits should work correctly with positive rewards', async () => {
    const { signers, accounts, adrs, strategy, stakingPool, wsdToken, stake } = await loadFixture(
      deployFixture
    )

    await stake(1000)
    await signers[0].sendTransaction({ to: adrs.rewardsReceiver, value: toEther(8) })
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(196), toEther(0))

    assert.equal(fromEther(await strategy.getDepositChange()), 105, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(adrs.nwlRewardsPool))
      ),
      17.0625,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(adrs.wlRewardsPool))
      ),
      2.625,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[4])),
      10.5,
      'owners rewards incorrect'
    )
    assert.equal(fromEther(await strategy.getDepositChange()), 0, 'depositChange incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1105, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await stakingPool.totalSupply()), 1105, 'totalSupply incorrect')
  })

  it('updateDeposits should work correctly with negative rewards', async () => {
    const { accounts, adrs, strategy, stakingPool, wsdToken, stake } = await loadFixture(
      deployFixture
    )

    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(95), toEther(0))

    assert.equal(fromEther(await strategy.getDepositChange()), -1, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(adrs.nwlRewardsPool))
      ),
      0,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(adrs.wlRewardsPool))
      ),
      0,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(accounts[4]))),
      0,
      'owners rewards incorrect'
    )
    assert.equal(fromEther(await strategy.getDepositChange()), 0, 'depositChange incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 999, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await stakingPool.totalSupply()), 999, 'totalSupply incorrect')
  })

  it('rewards receiver should work correctly', async () => {
    const { signers, adrs, wETH, strategy, rewardsReceiver, stake } = await loadFixture(
      deployFixture
    )

    await signers[0].sendTransaction({ to: adrs.rewardsReceiver, value: toEther(8) })
    await stake(32)
    await strategy.depositEther(2, 0, [], [])

    await strategy.reportBeaconState(2, toEther(64), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await strategy.bufferedETH()), 0)

    await strategy.reportBeaconState(2, toEther(63), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), -1)
    assert.equal(fromEther(await strategy.bufferedETH()), 0)

    await strategy.reportBeaconState(2, toEther(65), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 5)
    assert.equal(fromEther(await strategy.getDepositChange()), 6)
    assert.equal(fromEther(await strategy.bufferedETH()), 5)

    await strategy.reportBeaconState(2, toEther(66), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 5)
    assert.equal(fromEther(await strategy.getDepositChange()), 7)
    assert.equal(fromEther(await strategy.bufferedETH()), 5)

    await rewardsReceiver.setWithdrawalLimits(toEther(0), toEther(4))

    await strategy.reportBeaconState(2, toEther(67), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 8)
    assert.equal(fromEther(await strategy.getDepositChange()), 11)
    assert.equal(fromEther(await strategy.bufferedETH()), 8)

    await strategy.reportBeaconState(2, toEther(68), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(adrs.strategy)), 8)
    assert.equal(fromEther(await strategy.getDepositChange()), 12)
    assert.equal(fromEther(await strategy.bufferedETH()), 8)
  })

  it('setWLOperatorController should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    await strategy.setWLOperatorController(accounts[2])

    assert.equal(
      await strategy.wlOperatorController(),
      accounts[2],
      'wlOperatorController incorrect'
    )

    await expect(
      strategy.connect(signers[1]).setWLOperatorController(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setNWLOperatorController should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    await strategy.setNWLOperatorController(accounts[2])

    assert.equal(
      await strategy.nwlOperatorController(),
      accounts[2],
      'nwlOperatorController incorrect'
    )

    await expect(
      strategy.connect(signers[1]).setNWLOperatorController(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setBeaconOracle should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    await strategy.setBeaconOracle(accounts[2])

    assert.equal(await strategy.beaconOracle(), accounts[2], 'beaconOracle incorrect')

    await expect(strategy.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('setDepositController should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    await strategy.setDepositController(accounts[2])

    assert.equal(await strategy.depositController(), accounts[2], 'beaconOracle incorrect')

    await expect(strategy.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('nwlWithdraw should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    await strategy.setNWLOperatorController(accounts[1])

    await expect(strategy.nwlWithdraw(accounts[2], toEther(1))).to.be.revertedWith(
      'Sender is not non-whitelisted operator controller'
    )
    await expect(
      strategy.connect(signers[1]).nwlWithdraw(accounts[2], toEther(1))
    ).to.be.revertedWith('Not implemented yet')
  })

  it('setMaxDeposits and setMinDeposits should work correctly', async () => {
    const { signers, strategy } = await loadFixture(deployFixture)

    await strategy.setMaxDeposits(toEther(33))
    await strategy.setMinDeposits(toEther(44))

    assert.equal(fromEther(await strategy.getMaxDeposits()), 33, 'maxDeposits incorrect')
    assert.equal(fromEther(await strategy.getMinDeposits()), 44, 'minDeposits incorrect')

    await expect(strategy.connect(signers[1]).setMaxDeposits(toEther(1))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await expect(strategy.connect(signers[1]).setMinDeposits(toEther(1))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
