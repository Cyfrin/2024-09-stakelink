import { assert, expect } from 'chai'
import { deploy, fromEther, getAccounts, toEther } from '../utils/helpers'
import { RewardsReceiver } from '../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('RewardsReceiver', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const rewardsReceiver = (await deploy('RewardsReceiver', [
      accounts[0],
      toEther(4),
      toEther(5),
    ])) as RewardsReceiver
    adrs.rewardsReceiver = await rewardsReceiver.getAddress()

    return { signers, accounts, adrs, rewardsReceiver }
  }

  it('withdraw should work correctly', async () => {
    const { signers, adrs, rewardsReceiver } = await loadFixture(deployFixture)

    await signers[0].sendTransaction({ to: adrs.rewardsReceiver, value: toEther(8) })
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.rewardsReceiver)),
      8,
      'ETH balance incorrect'
    )

    await expect(rewardsReceiver.connect(signers[1]).withdraw()).to.be.revertedWith(
      'Sender is not ETH staking strategy'
    )

    let value = await rewardsReceiver.withdraw.staticCall()
    assert.equal(fromEther(value), 5, 'return value incorrect')

    await rewardsReceiver.withdraw()
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.rewardsReceiver)),
      3,
      'ETH balance incorrect'
    )

    value = await rewardsReceiver.withdraw.staticCall()
    assert.equal(fromEther(value), 0, 'return value incorrect')

    await rewardsReceiver.setWithdrawalLimits(toEther(0), toEther(5))

    value = await rewardsReceiver.withdraw.staticCall()
    assert.equal(fromEther(value), 3, 'return value incorrect')

    await rewardsReceiver.withdraw()
    assert.equal(
      fromEther(await ethers.provider.getBalance(adrs.rewardsReceiver)),
      0,
      'ETH balance incorrect'
    )

    value = await rewardsReceiver.withdraw.staticCall()
    assert.equal(fromEther(value), 0, 'return value incorrect')
  })
})
