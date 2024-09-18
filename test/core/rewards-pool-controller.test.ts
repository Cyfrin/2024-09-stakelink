import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import {
  ERC677,
  RewardsPool,
  RewardsPoolControllerMock,
  RewardsPoolTimeBased,
  RewardsPoolWSD,
  WrappedSDTokenMock,
} from '../../typechain-types'
import { ethers, network } from 'hardhat'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('RewardsPoolController', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token1 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token1',
      '1',
      1000000000,
    ])) as ERC677
    adrs.token1 = await token1.getAddress()
    await setupToken(token1, accounts)

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token2 = await token2.getAddress()
    await setupToken(token2, accounts)

    const stakingToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'StakingToken',
      'ST',
      1000000000,
    ])) as ERC677
    adrs.stakingToken = await stakingToken.getAddress()
    await setupToken(stakingToken, accounts)

    const controller = (await deployUpgradeable('RewardsPoolControllerMock', [
      adrs.stakingToken,
    ])) as RewardsPoolControllerMock
    adrs.controller = await controller.getAddress()

    const rewardsPool1 = (await deploy('RewardsPool', [
      adrs.controller,
      adrs.token1,
    ])) as RewardsPool
    adrs.rewardsPool1 = await rewardsPool1.getAddress()

    const rewardsPool2 = (await deploy('RewardsPool', [
      adrs.controller,
      adrs.token2,
    ])) as RewardsPool
    adrs.rewardsPool2 = await rewardsPool2.getAddress()

    async function stake(account: number, amount: number) {
      await stakingToken.connect(signers[account]).approve(adrs.controller, toEther(amount))
      await controller.connect(signers[account]).stake(toEther(amount))
    }

    async function withdraw(account: number, amount: number) {
      await controller.connect(signers[account]).withdraw(toEther(amount))
    }

    await controller.addToken(adrs.token1, adrs.rewardsPool1)
    await controller.addToken(adrs.token2, adrs.rewardsPool2)

    await stake(1, 1000)
    await stake(2, 500)

    return {
      signers,
      accounts,
      adrs,
      token1,
      token2,
      stakingToken,
      controller,
      rewardsPool1,
      rewardsPool2,
      stake,
      withdraw,
    }
  }

  it('should be able to add tokens', async () => {
    const { adrs, controller } = await loadFixture(deployFixture)

    const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token3',
      '3',
      1000000000,
    ])) as ERC677
    adrs.token3 = await token3.getAddress()

    const rewardsPool3 = (await deploy('RewardsPool', [
      adrs.controller,
      adrs.token3,
    ])) as RewardsPool
    adrs.rewardsPool3 = await rewardsPool3.getAddress()

    await controller.addToken(adrs.token3, adrs.rewardsPool3)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([adrs.token1, adrs.token2, adrs.token3]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to add token thats already supported', async () => {
    const { adrs, controller } = await loadFixture(deployFixture)

    await expect(controller.addToken(adrs.token1, adrs.rewardsPool1)).to.be.revertedWithCustomError(
      controller,
      'InvalidToken()'
    )
  })

  it('should be able to remove tokens', async () => {
    const { adrs, controller } = await loadFixture(deployFixture)

    await controller.removeToken(adrs.token1)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([adrs.token2]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to remove token thats not supported', async () => {
    const { adrs, controller } = await loadFixture(deployFixture)

    await expect(controller.removeToken(adrs.rewardsPool1)).to.be.revertedWithCustomError(
      controller,
      'InvalidToken()'
    )
  })

  describe('RewardsPool', () => {
    it('withdrawableRewards should work correctly', async () => {
      const { accounts, adrs, controller, token1, token2 } = await loadFixture(deployFixture)

      await token1.transferAndCall(adrs.rewardsPool1, toEther(900), '0x00')
      await token2.transferAndCall(adrs.rewardsPool2, toEther(300), '0x00')

      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, adrs, controller, token1, token2 } = await loadFixture(
        deployFixture
      )

      await token1.transferAndCall(adrs.rewardsPool1, toEther(900), '0x00')
      await token2.transferAndCall(adrs.rewardsPool2, toEther(300), '0x00')
      await controller.connect(signers[1]).withdrawRewards([adrs.token1, adrs.token2])
      await controller.connect(signers[2]).withdrawRewards([adrs.token2])

      assert.equal(
        fromEther(await token1.balanceOf(accounts[1])),
        10600,
        'account-1 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[1])),
        10200,
        'account-1 token-2 balance incorrect'
      )
      assert.equal(
        fromEther(await token1.balanceOf(accounts[2])),
        10000,
        'account-2 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[2])),
        10100,
        'account-2 token-2 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, adrs, token1, token2, rewardsPool1, rewardsPool2, stake, withdraw } =
        await loadFixture(deployFixture)

      await token1.transferAndCall(adrs.rewardsPool1, toEther(900), '0x00')
      await token2.transferAndCall(adrs.rewardsPool2, toEther(300), '0x00')

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, adrs, controller, token1, token2 } = await loadFixture(deployFixture)

      await token1.transfer(adrs.controller, toEther(900))
      await token2.transfer(adrs.controller, toEther(300))

      assert.deepEqual(
        await controller.tokenBalances(),
        [
          [adrs.token1, adrs.token2],
          [toEther(900), toEther(300)],
        ],
        'token balances incorrect'
      )

      await controller.distributeTokens([adrs.token1, adrs.token2])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })

  describe('RewardsPoolWSD', () => {
    async function deployFixture2() {
      const fixtureRet = await deployFixture()
      const adrs = fixtureRet.adrs

      const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token3',
        '3',
        1000000000,
      ])) as ERC677
      adrs.token3 = await token3.getAddress()
      await setupToken(token3, fixtureRet.accounts)

      const token4 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token4',
        '4',
        1000000000,
      ])) as ERC677
      adrs.token4 = await token4.getAddress()
      await setupToken(token4, fixtureRet.accounts)

      const wToken3 = (await deploy('WrappedSDTokenMock', [adrs.token3])) as WrappedSDTokenMock
      adrs.wToken3 = await wToken3.getAddress()

      const wToken4 = (await deploy('WrappedSDTokenMock', [adrs.token4])) as WrappedSDTokenMock
      adrs.wToken4 = await wToken4.getAddress()

      const rewardsPool3 = (await deploy('RewardsPoolWSD', [
        adrs.controller,
        adrs.token3,
        adrs.wToken3,
      ])) as RewardsPoolWSD
      adrs.rewardsPool3 = await rewardsPool3.getAddress()

      const rewardsPool4 = (await deploy('RewardsPoolWSD', [
        adrs.controller,
        adrs.token4,
        adrs.wToken4,
      ])) as RewardsPoolWSD
      adrs.rewardsPool4 = await rewardsPool4.getAddress()

      await fixtureRet.controller.addToken(adrs.token3, adrs.rewardsPool3)
      await fixtureRet.controller.addToken(adrs.token4, adrs.rewardsPool4)

      await token3.transferAndCall(adrs.controller, toEther(900), '0x00')
      await token4.transferAndCall(adrs.controller, toEther(300), '0x00')

      await token4.transfer(adrs.wToken4, toEther(900))

      await wToken3.setMultiplier(1)
      await wToken4.setMultiplier(4)

      return { ...fixtureRet, adrs, token3, token4, rewardsPool3, rewardsPool4, wToken3, wToken4 }
    }

    it('withdrawableRewards should work correctly', async () => {
      const { accounts, controller } = await loadFixture(deployFixture2)

      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 300, 400]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 200]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, adrs, controller, token3, token4 } = await loadFixture(
        deployFixture2
      )

      await controller.connect(signers[1]).withdrawRewards([adrs.token3, adrs.token4])
      await controller.connect(signers[2]).withdrawRewards([adrs.token4])

      assert.equal(
        fromEther(await token3.balanceOf(accounts[1])),
        10300,
        'account-1 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[1])),
        10400,
        'account-1 token-4 balance incorrect'
      )
      assert.equal(
        fromEther(await token3.balanceOf(accounts[2])),
        10000,
        'account-2 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[2])),
        10200,
        'account-2 token-4 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, rewardsPool3, rewardsPool4, withdraw, stake } = await loadFixture(
        deployFixture2
      )

      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, adrs, controller, token3, token4 } = await loadFixture(deployFixture2)

      await token3.transfer(adrs.controller, toEther(150))
      await token4.transfer(adrs.controller, toEther(300))

      assert.deepEqual(
        await controller.tokenBalances(),
        [
          [adrs.token1, adrs.token2, adrs.token3, adrs.token4],
          [toEther(0), toEther(0), toEther(150), toEther(300)],
        ],
        'token balances incorrect'
      )

      await controller.distributeTokens([adrs.token3, adrs.token4])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 400, 600]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 200, 300]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })

  describe('RewardsPoolTimeBased', () => {
    async function deployFixture3() {
      const fixtureRet = await deployFixture()
      const adrs = fixtureRet.adrs

      await network.provider.send('evm_setIntervalMining', [0])

      const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token3',
        '3',
        1000000000,
      ])) as ERC677
      adrs.token3 = await token3.getAddress()
      await setupToken(token3, fixtureRet.accounts)

      const tbRewardsPool = (await deploy('RewardsPoolTimeBased', [
        adrs.controller,
        adrs.token3,
        100,
        100000,
      ])) as RewardsPoolTimeBased
      adrs.tbRewardsPool = await tbRewardsPool.getAddress()

      await fixtureRet.controller.addToken(adrs.token3, adrs.tbRewardsPool)
      await token3.approve(adrs.tbRewardsPool, ethers.MaxUint256)

      return { ...fixtureRet, adrs, token3, tbRewardsPool }
    }

    it('depositRewards should work correctly with no previous epoch', async () => {
      const { adrs, tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      await expect(tbRewardsPool.depositRewards(100000, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )

      let ts = ((await ethers.provider.getBlock('latest'))?.timestamp || 0) + 1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(400))

      assert.equal(fromEther(await token3.balanceOf(adrs.tbRewardsPool)), 400)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 400)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 400)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 1000)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 1000)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0)
    })

    it('depositRewards should work correctly with previous completed epoch', async () => {
      const { adrs, tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await token3.balanceOf(adrs.tbRewardsPool)), 800)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 800)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 200)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 500)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 500)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.4)

      await expect(tbRewardsPool.depositRewards(ts + 499, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )
    })

    it('depositRewards should work correctly with epoch in progress', async () => {
      const { adrs, tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(499)
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await token3.balanceOf(adrs.tbRewardsPool)), 800)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 800)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 500)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 500)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 500)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.2)

      await expect(tbRewardsPool.depositRewards(ts + 499, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )
    })

    it('getRewardPerToken should work correctly', async () => {
      const { tbRewardsPool } = await loadFixture(deployFixture3)

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0)

      await time.increase(500)

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0.2)

      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0.2004)

      await time.increase(10000)

      assert.equal(Number(fromEther(await tbRewardsPool.getRewardPerToken()).toFixed(3)), 0.533)

      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 400, toEther(200))

      await time.increase(100)

      assert.equal(Number(fromEther(await tbRewardsPool.getRewardPerToken()).toFixed(3)), 0.567)
    })

    it('withdrawableRewards should work correctly', async () => {
      const { accounts, controller, tbRewardsPool } = await loadFixture(deployFixture3)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r)),
        [0, 0, 0]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r)),
        [0, 0, 0]
      )

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r)),
        [0, 0, 0]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r)),
        [0, 0, 0]
      )
      await time.increase(500)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r)),
        [0, 0, 200]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r)),
        [0, 0, 100]
      )
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r)),
        [0, 0, 200.4]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r)),
        [0, 0, 100.2]
      )
      await time.increase(10000)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 533.33]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 266.67]
      )
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 400, toEther(200))

      await time.increase(100)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 566.67]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 283.33]
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, adrs, controller, tbRewardsPool, token3 } = await loadFixture(
        deployFixture3
      )

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)

      await controller.connect(signers[1]).withdrawRewards([adrs.token3])
      await controller.connect(signers[2]).withdrawRewards([adrs.token3])

      assert.equal(fromEther(await token3.balanceOf(accounts[1])), 10400)
      assert.equal(fromEther(await token3.balanceOf(accounts[2])), 10200)
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0])
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0])
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, tbRewardsPool, withdraw, stake } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)

      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[1])), 0)
      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[2])), 0)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0)

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[1])), 0.4)
      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[2])), 0.4)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.4)
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, adrs, controller, token3 } = await loadFixture(deployFixture3)

      await token3.transfer(adrs.controller, toEther(150))

      await controller.distributeTokens([adrs.token3])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 100])
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 50])
      )
    })
  })
})
