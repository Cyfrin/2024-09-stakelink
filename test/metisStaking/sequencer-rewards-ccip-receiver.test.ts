import { ethers } from 'hardhat'
import { assert } from 'chai'
import { toEther, deploy, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC677,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SequencerRewardsCCIPReceiver,
  SequencerVCSMock,
  MetisLockingInfoMock,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('SequencerRewardsCCIPReceiver', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
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

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token2 = await token2.getAddress()

    const wrappedNative = await deploy('WrappedNative')
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [
      await wrappedNative.getAddress(),
      await armProxy.getAddress(),
    ])

    const tokenPool = (await deploy('CCIPTokenPoolMock', [adrs.token])) as CCIPTokenPoolMock
    adrs.tokenPool = await tokenPool.getAddress()

    const tokenPool2 = (await deploy('CCIPTokenPoolMock', [adrs.token2])) as CCIPTokenPoolMock
    adrs.tokenPool2 = await tokenPool2.getAddress()

    const offRamp = (await deploy('CCIPOffRampMock', [
      await router.getAddress(),
      [adrs.token, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
    ])) as CCIPOffRampMock
    adrs.offRamp = await offRamp.getAddress()

    await router.applyRampUpdates([], [], [[77, adrs.offRamp]])

    let metisLockingInfo = (await deploy('MetisLockingInfoMock', [
      adrs.token,
      toEther(100),
      toEther(10000),
    ])) as MetisLockingInfoMock

    const strategy = (await deploy('SequencerVCSMock', [
      adrs.token,
      await metisLockingInfo.getAddress(),
      1000,
      5000,
    ])) as SequencerVCSMock
    adrs.strategy = await strategy.getAddress()

    const ccipReceiver = (await deploy('SequencerRewardsCCIPReceiver', [
      await router.getAddress(),
      adrs.token,
      adrs.strategy,
      accounts[1],
      accounts[0],
    ])) as SequencerRewardsCCIPReceiver
    adrs.ccipReceiver = await ccipReceiver.getAddress()

    return {
      signers,
      accounts,
      adrs,
      linkToken,
      token,
      token2,
      tokenPool,
      tokenPool2,
      offRamp,
      strategy,
      ccipReceiver,
    }
  }

  it('ccipReceive should work correctly', async () => {
    const { signers, accounts, adrs, token, token2, strategy, offRamp } = await loadFixture(
      deployFixture
    )

    await token.transfer(adrs.tokenPool, toEther(100))
    await offRamp.executeSingleMessage(
      ethers.encodeBytes32String('messageId'),
      77,
      '0x',
      adrs.ccipReceiver,
      [{ token: adrs.token, amount: toEther(25) }]
    )

    assert.equal(fromEther(await strategy.lastL2RewardsAmount()), 25)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 25)

    await token2.transfer(adrs.tokenPool2, toEther(100))

    let success: any = await offRamp.executeSingleMessage.staticCall(
      ethers.encodeBytes32String('messageId'),
      77,
      '0x',
      adrs.ccipReceiver,
      [
        { token: adrs.token, amount: toEther(25) },
        { token: adrs.token2, amount: toEther(25) },
      ]
    )
    assert.equal(success, false)

    success = await offRamp.executeSingleMessage.staticCall(
      ethers.encodeBytes32String('messageId'),
      77,
      '0x',
      adrs.ccipReceiver,
      [{ token: adrs.token2, amount: toEther(25) }]
    )
    assert.equal(success, false)

    success = await offRamp
      .connect(signers[5])
      .executeSingleMessage.staticCall(
        ethers.encodeBytes32String('messageId'),
        77,
        '0x',
        adrs.ccipReceiver,
        [{ token: adrs.token, amount: toEther(25) }]
      )
    assert.equal(success, false)
  })
})
