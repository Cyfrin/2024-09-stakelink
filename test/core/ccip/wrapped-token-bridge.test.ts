import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  WrappedTokenBridge,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  WrappedNative,
} from '../../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('WrappedTokenBridge', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()
    const adrs: any = {}

    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.linkToken = await linkToken.getAddress()

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token2 = await token2.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.linkToken,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const wrappedToken = (await deploy('WrappedSDToken', [
      adrs.stakingPool,
      'Wrapped  stLINK',
      'wstLINK',
    ])) as WrappedSDToken
    adrs.wrappedToken = await wrappedToken.getAddress()

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.linkToken,
      adrs.stakingPool,
      toEther(100000),
      toEther(0),
    ])) as StrategyMock

    await stakingPool.addStrategy(await strategy.getAddress())
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await linkToken.approve(adrs.stakingPool, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(10000), ['0x'])
    await stakingPool.deposit(accounts[1], toEther(2000), ['0x'])
    await linkToken.transfer(await strategy.getAddress(), toEther(12000))
    await stakingPool.updateStrategyRewards([0], '0x')

    const wrappedNative = (await deploy('WrappedNative')) as WrappedNative
    adrs.wrappedNative = await wrappedNative.getAddress()

    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [adrs.wrappedNative, await armProxy.getAddress()])

    const tokenPool = (await deploy('CCIPTokenPoolMock', [adrs.wrappedToken])) as CCIPTokenPoolMock
    adrs.tokenPool = await tokenPool.getAddress()

    const tokenPool2 = (await deploy('CCIPTokenPoolMock', [adrs.token2])) as CCIPTokenPoolMock
    adrs.tokenPool2 = await tokenPool2.getAddress()

    const onRamp = (await deploy('CCIPOnRampMock', [
      [adrs.wrappedToken, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
      adrs.linkToken,
    ])) as CCIPOnRampMock
    adrs.onRamp = await onRamp.getAddress()

    const offRamp = (await deploy('CCIPOffRampMock', [
      await router.getAddress(),
      [adrs.wrappedToken, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
    ])) as CCIPOffRampMock
    adrs.offRamp = await offRamp.getAddress()

    await router.applyRampUpdates([[77, adrs.onRamp]], [], [[77, adrs.offRamp]])

    const bridge = (await deploy('WrappedTokenBridge', [
      await router.getAddress(),
      adrs.linkToken,
      adrs.stakingPool,
      adrs.wrappedToken,
    ])) as WrappedTokenBridge
    adrs.bridge = await bridge.getAddress()

    await linkToken.approve(adrs.bridge, ethers.MaxUint256)
    await stakingPool.approve(adrs.bridge, ethers.MaxUint256)

    return {
      accounts,
      adrs,
      linkToken,
      token2,
      stakingPool,
      wrappedToken,
      wrappedNative,
      tokenPool,
      tokenPool2,
      onRamp,
      offRamp,
      bridge,
    }
  }

  it('getFee should work correctly', async () => {
    const { bridge } = await loadFixture(deployFixture)

    assert.equal(fromEther(await bridge.getFee(77, 1000, false)), 2)
    assert.equal(fromEther(await bridge.getFee(77, 1000, true)), 3)
    await expect(bridge.getFee(78, 1000, false)).to.be.reverted
    await expect(bridge.getFee(78, 1000, true)).to.be.reverted
  })

  it('transferTokens should work correctly with LINK fee', async () => {
    const { accounts, adrs, bridge, linkToken, onRamp, wrappedToken } = await loadFixture(
      deployFixture
    )

    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferTokens(77, accounts[4], toEther(100), false, toEther(10))
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(adrs.tokenPool)), 50)
    assert.equal(fromEther(preFeeBalance - (await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.bridge)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.wrappedToken, 50]]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)

    await expect(
      bridge.transferTokens(77, accounts[4], toEther(100), false, toEther(1))
    ).to.be.revertedWithCustomError(bridge, 'FeeExceedsLimit()')
  })

  it('transferTokens should work correctly with native fee', async () => {
    const { accounts, adrs, bridge, onRamp, wrappedToken } = await loadFixture(deployFixture)

    let preFeeBalance = await ethers.provider.getBalance(accounts[0])

    await bridge.transferTokens(77, accounts[4], toEther(100), true, 0, {
      value: toEther(10),
    })
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(adrs.tokenPool)), 50)
    assert.equal(
      Math.trunc(fromEther(preFeeBalance - (await ethers.provider.getBalance(accounts[0])))),
      3
    )

    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], adrs.bridge)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.wrappedToken, 50]]
    )
    assert.equal(lastRequestMsg[3], adrs.wrappedNative)
  })

  it('onTokenTransfer should work correctly', async () => {
    const { accounts, adrs, bridge, linkToken, onRamp, wrappedToken, stakingPool } =
      await loadFixture(deployFixture)

    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await stakingPool.transferAndCall(
      adrs.bridge,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint64', 'address', 'uint256', 'bytes'],
        [77, accounts[4], toEther(10), '0x']
      )
    )

    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(adrs.tokenPool)), 50)
    assert.equal(fromEther(preFeeBalance - (await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.bridge)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.wrappedToken, 50]]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)

    await expect(
      bridge.onTokenTransfer(accounts[0], toEther(1000), '0x')
    ).to.be.revertedWithCustomError(bridge, 'InvalidSender()')
    await expect(stakingPool.transferAndCall(adrs.bridge, 0, '0x')).to.be.revertedWithCustomError(
      bridge,
      'InvalidValue()'
    )
    await expect(
      stakingPool.transferAndCall(
        adrs.bridge,
        toEther(100),
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint64', 'address', 'uint256', 'bytes'],
          [77, accounts[4], toEther(1), '0x']
        )
      )
    ).to.be.revertedWithCustomError(bridge, 'FeeExceedsLimit()')
  })

  it('ccipReceive should work correctly', async () => {
    const { accounts, adrs, stakingPool, offRamp, token2 } = await loadFixture(deployFixture)

    await stakingPool.transferAndCall(
      adrs.bridge,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint64', 'address', 'uint256', 'bytes'],
        [77, accounts[4], toEther(10), '0x']
      )
    )
    await offRamp.executeSingleMessage(
      ethers.encodeBytes32String('messageId'),
      77,
      ethers.AbiCoder.defaultAbiCoder().encode(['address'], [accounts[5]]),
      adrs.bridge,
      [{ token: adrs.wrappedToken, amount: toEther(25) }]
    )

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[5])), 50)

    await token2.transfer(adrs.tokenPool2, toEther(100))

    let success: any = await offRamp.executeSingleMessage.staticCall(
      ethers.encodeBytes32String('messageId'),
      77,
      ethers.AbiCoder.defaultAbiCoder().encode(['address'], [accounts[5]]),
      adrs.bridge,
      [
        { token: adrs.wrappedToken, amount: toEther(25) },
        { token: adrs.token2, amount: toEther(25) },
      ]
    )
    assert.equal(success, false)

    success = await offRamp.executeSingleMessage.staticCall(
      ethers.encodeBytes32String('messageId'),
      77,
      ethers.AbiCoder.defaultAbiCoder().encode(['address'], [accounts[5]]),
      adrs.bridge,
      [{ token: adrs.token2, amount: toEther(25) }]
    )
    assert.equal(success, false)

    success = await offRamp.executeSingleMessage.staticCall(
      ethers.encodeBytes32String('messageId'),
      77,
      '0x',
      adrs.bridge,
      [{ token: adrs.wrappedToken, amount: toEther(25) }]
    )
    assert.equal(success, false)
  })

  it('recoverTokens should work correctly', async () => {
    const { accounts, adrs, bridge, linkToken, stakingPool } = await loadFixture(deployFixture)

    await linkToken.transfer(adrs.bridge, toEther(1000))
    await stakingPool.transfer(adrs.bridge, toEther(2000))
    await bridge.recoverTokens(
      [adrs.linkToken, adrs.stakingPool],
      [toEther(1000), toEther(2000)],
      accounts[3]
    )

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 2000)
  })
})
