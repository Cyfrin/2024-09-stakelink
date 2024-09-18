import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import { ERC677, InsurancePool, RewardsPoolTimeBased } from '../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('InsurancePool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token1',
      '1',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)
    adrs.token = await token.getAddress()

    const stakingToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'StakingToken',
      'ST',
      1000000000,
    ])) as ERC677
    await setupToken(stakingToken, accounts)
    adrs.stakingToken = await stakingToken.getAddress()

    const insurancePool = (await deployUpgradeable('InsurancePool', [
      adrs.stakingToken,
      'name',
      'symbol',
      accounts[0],
      3000,
      0,
      0,
    ])) as InsurancePool
    adrs.insurancePool = await insurancePool.getAddress()

    const rewardsPool = (await deploy('RewardsPoolTimeBased', [
      adrs.insurancePool,
      adrs.token,
      100,
      100000,
    ])) as RewardsPoolTimeBased
    adrs.rewardsPool = await rewardsPool.getAddress()

    await insurancePool.setRewardsPool(adrs.rewardsPool)
    await stakingToken.approve(adrs.insurancePool, ethers.MaxUint256)
    await stakingToken.connect(signers[1]).approve(adrs.insurancePool, ethers.MaxUint256)
    await token.approve(adrs.rewardsPool, ethers.MaxUint256)
    await insurancePool.deposit(1000)

    return { accounts, signers, adrs, token, stakingToken, insurancePool, rewardsPool }
  }

  it('deposit should work correctly', async () => {
    const { accounts, signers, adrs, insurancePool, stakingToken, rewardsPool } = await loadFixture(
      deployFixture
    )

    await insurancePool.deposit(toEther(1000))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))
    await insurancePool.withdraw(1000)

    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 4000)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.insurancePool)), 4000)

    let ts: any = (await ethers.provider.getBlock('latest'))?.timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await insurancePool.deposit(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)
  })

  it('withdraw should work correctly', async () => {
    const { accounts, signers, adrs, insurancePool, stakingToken, rewardsPool } = await loadFixture(
      deployFixture
    )

    await insurancePool.setWithdrawalParams(10, 100)
    await insurancePool.deposit(toEther(1200))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))

    await expect(insurancePool.withdraw(toEther(200))).to.be.revertedWithCustomError(
      insurancePool,
      'WithdrawalWindowInactive()'
    )

    await insurancePool.requestWithdrawal()
    await time.increase(10)
    await insurancePool.withdraw(toEther(200))

    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 4000)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.insurancePool)), 4000)

    let ts: any = (await ethers.provider.getBlock('latest'))?.timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await insurancePool.connect(signers[1]).requestWithdrawal()
    await time.increase(10)
    await insurancePool.connect(signers[1]).withdraw(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 750)
  })

  it('claim process should work correctly', async () => {
    const { accounts, signers, adrs, insurancePool, stakingToken, rewardsPool, token } =
      await loadFixture(deployFixture)

    await expect(insurancePool.executeClaim(10)).to.be.revertedWithCustomError(
      insurancePool,
      'NoClaimInProgress()'
    )
    await expect(insurancePool.resolveClaim()).to.be.revertedWithCustomError(
      insurancePool,
      'NoClaimInProgress()'
    )

    await insurancePool.deposit(toEther(1000))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))
    await token.transferAndCall(adrs.rewardsPool, toEther(1000), '0x')
    await insurancePool.initiateClaim()

    assert.equal(await insurancePool.claimInProgress(), true)
    await expect(insurancePool.deposit(toEther(100))).to.be.revertedWithCustomError(
      insurancePool,
      'ClaimInProgress()'
    )
    await expect(insurancePool.withdraw(toEther(100))).to.be.revertedWithCustomError(
      insurancePool,
      'ClaimInProgress()'
    )
    await expect(insurancePool.executeClaim(toEther(1201))).to.be.revertedWithCustomError(
      insurancePool,
      'ExceedsMaxClaimAmount()'
    )

    await insurancePool.executeClaim(toEther(1200))

    assert.equal(await insurancePool.claimInProgress(), true)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[1])), 750)
    assert.equal(fromEther(await insurancePool.staked(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.staked(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 700)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 2100)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 2800)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.insurancePool)), 2800)

    await insurancePool.resolveClaim()
  })
})
