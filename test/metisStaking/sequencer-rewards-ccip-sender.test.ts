import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, getAccounts, fromEther, deployUpgradeable } from '../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPTokenPoolMock,
  SequencerRewardsCCIPSender,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('SequencerRewardsCCIPSender', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()
    const adrs: any = {}

    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.linkToken = await linkToken.getAddress()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '1',
      '1',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    const wrappedNative = await deploy('WrappedNative')
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [
      await wrappedNative.getAddress(),
      await armProxy.getAddress(),
    ])

    const tokenPool = (await deploy('CCIPTokenPoolMock', [adrs.token])) as CCIPTokenPoolMock
    adrs.tokenPool = await tokenPool.getAddress()

    const onRamp = (await deploy('CCIPOnRampMock', [
      [adrs.token],
      [adrs.tokenPool],
      adrs.linkToken,
    ])) as CCIPOnRampMock
    adrs.onRamp = await onRamp.getAddress()

    await router.applyRampUpdates([[77, adrs.onRamp]], [], [])

    const ccipSender = (await deployUpgradeable('SequencerRewardsCCIPSender', [
      await router.getAddress(),
      adrs.linkToken,
      adrs.token,
      accounts[0],
      77,
      '0x1111',
    ])) as SequencerRewardsCCIPSender
    adrs.ccipSender = await ccipSender.getAddress()

    await ccipSender.setDestinationReceiver(accounts[5])

    return { accounts, adrs, linkToken, token, tokenPool, onRamp, ccipSender }
  }

  it('transferRewards should work correctly', async () => {
    const { accounts, adrs, linkToken, token, ccipSender, onRamp } = await loadFixture(
      deployFixture
    )

    await linkToken.transfer(adrs.ccipSender, toEther(10))
    await token.transfer(adrs.ccipSender, toEther(100))

    await ccipSender.transferRewards(toEther(10))
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await token.balanceOf(adrs.tokenPool)), 100)
    assert.equal(fromEther(await linkToken.balanceOf(adrs.ccipSender)), 8)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.ccipSender)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[5]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.token, 100]]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)
    assert.equal(lastRequestMsg[4], '0x1111')

    await expect(ccipSender.transferRewards(toEther(10))).to.be.revertedWithCustomError(
      ccipSender,
      'NoRewards()'
    )

    await token.transfer(adrs.ccipSender, toEther(100))
    await expect(ccipSender.transferRewards(toEther(1))).to.be.revertedWithCustomError(
      ccipSender,
      'FeeExceedsLimit()'
    )
  })
})
