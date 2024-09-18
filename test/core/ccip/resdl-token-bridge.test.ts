import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  WrappedNative,
  RESDLTokenBridge,
  SDLPoolPrimary,
  SDLPoolCCIPControllerPrimary,
} from '../../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('RESDLTokenBridge', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.linkToken = await linkToken.getAddress()

    const sdlToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'SDL',
      'SDL',
      1000000000,
    ])) as ERC677
    adrs.sdlToken = await sdlToken.getAddress()

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token2 = await token2.getAddress()

    const wrappedNative = (await deploy('WrappedNative')) as WrappedNative
    adrs.wrappedNative = await wrappedNative.getAddress()

    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [adrs.wrappedNative, await armProxy.getAddress()])

    const tokenPool = (await deploy('CCIPTokenPoolMock', [adrs.sdlToken])) as CCIPTokenPoolMock
    adrs.tokenPool = await tokenPool.getAddress()

    const tokenPool2 = (await deploy('CCIPTokenPoolMock', [adrs.token2])) as CCIPTokenPoolMock
    adrs.tokenPool2 = await tokenPool2.getAddress()

    const onRamp = (await deploy('CCIPOnRampMock', [
      [adrs.sdlToken, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
      adrs.linkToken,
    ])) as CCIPOnRampMock
    adrs.onRamp = await onRamp.getAddress()

    const offRamp = (await deploy('CCIPOffRampMock', [
      await router.getAddress(),
      [adrs.sdlToken, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
    ])) as CCIPOffRampMock
    adrs.offRamp = await offRamp.getAddress()

    await router.applyRampUpdates([[77, adrs.onRamp]], [], [[77, adrs.offRamp]])

    let boostController = await deploy('LinearBoostController', [10, 4 * 365 * 86400, 4])
    const sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'reSDL',
      'reSDL',
      adrs.sdlToken,
      await boostController.getAddress(),
    ])) as SDLPoolPrimary
    adrs.sdlPool = await sdlPool.getAddress()

    const sdlPoolCCIPController = (await deploy('SDLPoolCCIPControllerPrimary', [
      await router.getAddress(),
      adrs.linkToken,
      adrs.sdlToken,
      adrs.sdlPool,
      toEther(10),
      accounts[0],
    ])) as SDLPoolCCIPControllerPrimary
    adrs.sdlPoolCCIPController = await sdlPoolCCIPController.getAddress()

    const bridge = (await deploy('RESDLTokenBridge', [
      adrs.linkToken,
      adrs.sdlToken,
      adrs.sdlPool,
      adrs.sdlPoolCCIPController,
    ])) as RESDLTokenBridge
    adrs.bridge = await bridge.getAddress()

    await sdlPoolCCIPController.setRESDLTokenBridge(adrs.bridge)
    await sdlPool.setCCIPController(adrs.sdlPoolCCIPController)
    await linkToken.approve(adrs.bridge, ethers.MaxUint256)
    await sdlPoolCCIPController.addWhitelistedChain(77, accounts[6])
    await sdlToken.transfer(accounts[1], toEther(200))

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(200),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )

    return {
      signers,
      accounts,
      adrs,
      linkToken,
      sdlToken,
      token2,
      wrappedNative,
      tokenPool,
      tokenPool2,
      onRamp,
      offRamp,
      sdlPool,
      sdlPoolCCIPController,
      bridge,
    }
  }

  it('getFee should work correctly', async () => {
    const { bridge } = await loadFixture(deployFixture)

    assert.equal(fromEther(await bridge.getFee(77, false, 1)), 2)
    assert.equal(fromEther(await bridge.getFee(77, true, 1)), 3)
    await expect(bridge.getFee(78, false, 1)).to.be.reverted
    await expect(bridge.getFee(78, true, 1)).to.be.reverted
  })

  it('transferRESDL should work correctly with LINK fee', async () => {
    const { accounts, adrs, bridge, sdlPool, linkToken, onRamp, sdlToken } = await loadFixture(
      deployFixture
    )

    let ts1: any = (await ethers.provider.getBlock('latest'))?.timestamp
    await time.setNextBlockTimestamp(ts1 + 365 * 86400)
    await sdlPool.initiateUnlock(2)
    let ts2: any = (await ethers.provider.getBlock('latest'))?.timestamp

    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferRESDL(77, accounts[4], 2, false, toEther(10), 1)
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(adrs.tokenPool)), 1000)
    assert.equal(fromEther(preFeeBalance - (await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.sdlPoolCCIPController)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[6]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return Number(d)
        }),
      [accounts[4], 2, 1000, 0, ts1, 365 * 86400, ts2 + (365 * 86400) / 2]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.sdlToken, 1000]]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)
    assert.equal(
      lastRequestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )
    await expect(sdlPool.ownerOf(3)).to.be.revertedWithCustomError(sdlPool, 'InvalidLockId()')

    await expect(
      bridge.transferRESDL(77, accounts[4], 1, false, toEther(1), 1)
    ).to.be.revertedWithCustomError(bridge, 'FeeExceedsLimit()')

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(500),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 2 * 365 * 86400])
    )
    let ts3 = (await ethers.provider.getBlock('latest'))?.timestamp

    preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferRESDL(77, accounts[5], 3, false, toEther(10), 1)
    lastRequestData = await onRamp.getLastRequestData()
    lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(adrs.tokenPool)), 1500)
    assert.equal(fromEther(preFeeBalance - (await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.sdlPoolCCIPController)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[6]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return Number(d)
        }),
      [accounts[5], 3, 500, 1000, ts3, 2 * 365 * 86400, 0]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.sdlToken, 500]]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)
    assert.equal(
      lastRequestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )
    await expect(sdlPool.ownerOf(3)).to.be.revertedWithCustomError(sdlPool, 'InvalidLockId()')
  })

  it('transferRESDL should work correctly with native fee', async () => {
    const { accounts, adrs, bridge, sdlPool, onRamp, sdlToken } = await loadFixture(deployFixture)

    let ts = (await ethers.provider.getBlock('latest'))?.timestamp

    let preFeeBalance = await ethers.provider.getBalance(accounts[0])

    await bridge.transferRESDL(77, accounts[4], 2, true, toEther(10), 1, { value: toEther(10) })
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(adrs.tokenPool)), 1000)
    assert.equal(
      Math.trunc(fromEther(preFeeBalance - (await ethers.provider.getBalance(accounts[0])))),
      3
    )
    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], adrs.sdlPoolCCIPController)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[6]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return Number(d)
        }),
      [accounts[4], 2, 1000, 1000, ts, 365 * 86400, 0]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[adrs.sdlToken, 1000]]
    )
    assert.equal(lastRequestMsg[3], adrs.wrappedNative)
    assert.equal(
      lastRequestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )
    await expect(sdlPool.ownerOf(3)).to.be.revertedWithCustomError(sdlPool, 'InvalidLockId()')
  })

  it('ccipReceive should work correctly', async () => {
    const { signers, accounts, adrs, bridge, sdlPool, sdlToken, offRamp } = await loadFixture(
      deployFixture
    )

    await bridge.transferRESDL(77, accounts[4], 2, true, toEther(10), 1, { value: toEther(10) })

    let success: any = await offRamp
      .connect(signers[1])
      .executeSingleMessage.staticCall(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          [accounts[5], 2, toEther(25), toEther(25), 1000, 3000, 8000]
        ),
        adrs.sdlPoolCCIPController,
        [{ token: adrs.sdlToken, amount: toEther(25) }]
      )
    assert.equal(success, false)

    await offRamp
      .connect(signers[6])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          [accounts[5], 2, toEther(25), toEther(25), 1000, 3000, 8000]
        ),
        adrs.sdlPoolCCIPController,
        [{ token: adrs.sdlToken, amount: toEther(25) }]
      )

    assert.equal(fromEther(await sdlToken.balanceOf(adrs.sdlPool)), 225)
    assert.equal(await sdlPool.ownerOf(2), accounts[5])
    assert.deepEqual(
      (await sdlPool.getLocks([2])).map((l: any) => ({
        amount: fromEther(l.amount),
        boostAmount: Number(fromEther(l.boostAmount).toFixed(4)),
        startTime: Number(l.startTime),
        duration: Number(l.duration),
        expiry: Number(l.expiry),
      })),
      [
        {
          amount: 25,
          boostAmount: 25,
          startTime: 1000,
          duration: 3000,
          expiry: 8000,
        },
      ]
    )
  })

  it('transferRESDL validation should work correctly', async () => {
    const { signers, accounts, bridge, sdlPoolCCIPController } = await loadFixture(deployFixture)

    await expect(
      bridge.connect(signers[1]).transferRESDL(77, accounts[4], 1, false, toEther(10), 1)
    ).to.be.revertedWithCustomError(bridge, 'SenderNotAuthorized()')
    await expect(
      bridge.transferRESDL(77, ethers.ZeroAddress, 1, false, toEther(10), 1)
    ).to.be.revertedWithCustomError(bridge, 'InvalidReceiver()')
    await expect(
      bridge.transferRESDL(78, accounts[4], 1, false, toEther(10), 1)
    ).to.be.revertedWithCustomError(sdlPoolCCIPController, 'InvalidDestination()')

    bridge.transferRESDL(77, accounts[4], 1, false, toEther(10), 1)
  })
})
