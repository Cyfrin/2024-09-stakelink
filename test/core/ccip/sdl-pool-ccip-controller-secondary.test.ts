import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SDLPoolCCIPControllerSecondary,
  SDLPoolSecondary,
} from '../../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const parseLock = (lock: any) => ({
  amount: fromEther(lock[0]),
  boostAmount: Number(fromEther(lock[1]).toFixed(4)),
  startTime: Number(lock[2]),
  duration: Number(lock[3]),
  expiry: Number(lock[4]),
})

describe('SDLPoolCCIPControllerSecondary', () => {
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

    const token1 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token1 = await token1.getAddress()

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677
    adrs.token2 = await token2.getAddress()

    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [accounts[0], await armProxy.getAddress()])

    const tokenPool = (await deploy('CCIPTokenPoolMock', [adrs.token1])) as CCIPTokenPoolMock
    adrs.tokenPool = await tokenPool.getAddress()

    const tokenPool2 = (await deploy('CCIPTokenPoolMock', [adrs.token2])) as CCIPTokenPoolMock
    adrs.tokenPool2 = await tokenPool2.getAddress()

    const onRamp = (await deploy('CCIPOnRampMock', [
      [adrs.token1, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
      adrs.linkToken,
    ])) as CCIPOnRampMock
    adrs.onRamp = await onRamp.getAddress()

    const offRamp = (await deploy('CCIPOffRampMock', [
      await router.getAddress(),
      [adrs.token1, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
    ])) as CCIPOffRampMock
    adrs.offRamp = await offRamp.getAddress()

    await router.applyRampUpdates([[77, adrs.onRamp]], [], [[77, adrs.offRamp]])

    let boostController = await deploy('LinearBoostController', [10, 4 * 365 * 86400, 4])
    const sdlPool = (await deployUpgradeable('SDLPoolSecondary', [
      'reSDL',
      'reSDL',
      adrs.sdlToken,
      await boostController.getAddress(),
      5,
    ])) as SDLPoolSecondary
    adrs.sdlPool = await sdlPool.getAddress()

    const controller = (await deploy('SDLPoolCCIPControllerSecondary', [
      await router.getAddress(),
      adrs.linkToken,
      adrs.sdlToken,
      adrs.sdlPool,
      77,
      accounts[4],
      toEther(10),
      accounts[0],
      100,
    ])) as SDLPoolCCIPControllerSecondary
    adrs.controller = await controller.getAddress()

    await linkToken.transfer(adrs.controller, toEther(100))
    await sdlToken.transfer(accounts[1], toEther(200))
    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        adrs.sdlPool,
        toEther(200),
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlPool.setCCIPController(accounts[0])
    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.executeQueuedOperations([])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.setCCIPController(adrs.controller)
    await controller.setRESDLTokenBridge(accounts[5])

    return {
      signers,
      accounts,
      adrs,
      linkToken,
      sdlToken,
      token1,
      token2,
      tokenPool,
      tokenPool2,
      onRamp,
      offRamp,
      sdlPool,
      controller,
    }
  }

  it('handleOutgoingRESDL should work correctly', async () => {
    const { signers, accounts, adrs, controller, sdlToken, sdlPool } = await loadFixture(
      deployFixture
    )

    await expect(
      controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 2)
    ).to.be.revertedWithCustomError(controller, 'SenderNotAuthorized()')

    assert.deepEqual(
      await controller
        .connect(signers[5])
        .handleOutgoingRESDL.staticCall(77, accounts[1], 2)
        .then((d: any) => [d[0], parseLock(d[1])]),
      [accounts[4], { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 }]
    )

    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[1], 2)
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.controller)), 200)
    await expect(sdlPool.ownerOf(2)).to.be.revertedWithCustomError(sdlPool, 'InvalidLockId()')
  })

  it('handleIncomingRESDL should work correctly', async () => {
    const { signers, accounts, adrs, controller, sdlToken, sdlPool } = await loadFixture(
      deployFixture
    )

    await sdlToken.transfer(adrs.controller, toEther(300))

    await controller.connect(signers[5]).handleIncomingRESDL(77, accounts[3], 7, {
      amount: toEther(300),
      boostAmount: toEther(200),
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.controller)), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.sdlPool)), 600)
    assert.equal(await sdlPool.ownerOf(7), accounts[3])
    assert.deepEqual(parseLock((await sdlPool.getLocks([7]))[0]), {
      amount: 300,
      boostAmount: 200,
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
  })

  it('shouldUpdate should work correctly', async () => {
    const { adrs, controller, sdlToken } = await loadFixture(deployFixture)

    assert.equal(await controller.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )

    assert.equal(await controller.shouldUpdate(), true)

    await controller.executeUpdate(1)
    assert.equal(await controller.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )

    assert.equal(await controller.shouldUpdate(), false)

    await time.increase(100)

    assert.equal(await controller.shouldUpdate(), false)
  })

  it('executeUpdate should work correctly', async () => {
    const { signers, accounts, adrs, controller, sdlToken, sdlPool, onRamp, linkToken, offRamp } =
      await loadFixture(deployFixture)

    await expect(controller.executeUpdate(1)).to.be.revertedWithCustomError(
      controller,
      'UpdateConditionsNotMet()'
    )

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await controller.executeUpdate(1)
    await expect(controller.executeUpdate(1)).to.be.revertedWithCustomError(
      controller,
      'UpdateConditionsNotMet()'
    )

    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 98)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.controller)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(['uint256', 'int256'], lastRequestMsg[1])
        .map((d, i) => (i == 0 ? Number(d) : fromEther(d))),
      [1, 200]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)
    assert.equal(
      lastRequestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [3]),
        adrs.controller,
        []
      )
    await expect(controller.executeUpdate(1)).to.be.revertedWithCustomError(
      controller,
      'UpdateConditionsNotMet()'
    )

    await sdlPool.connect(signers[1]).withdraw(2, toEther(10))
    await expect(controller.executeUpdate(1)).to.be.revertedWithCustomError(
      controller,
      'UpdateConditionsNotMet()'
    )

    await time.increase(100)
    await controller.executeUpdate(2)

    lastRequestData = await onRamp.getLastRequestData()
    lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 96)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], adrs.controller)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(['uint256', 'int256'], lastRequestMsg[1])
        .map((d, i) => (i == 0 ? Number(d) : fromEther(d))),
      [0, -10]
    )
    assert.equal(lastRequestMsg[3], adrs.linkToken)
    assert.equal(
      lastRequestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [2]).slice(2)
    )
  })

  it('ccipReceive should work correctly for reward distributions', async () => {
    const { signers, accounts, adrs, controller, sdlToken, sdlPool, token1, token2, offRamp } =
      await loadFixture(deployFixture)

    await token1.transfer(adrs.tokenPool, toEther(1000))
    await token2.transfer(adrs.tokenPool2, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [adrs.sdlPool, adrs.token1])
    adrs.rewardsPool1 = await rewardsPool1.getAddress()

    await sdlPool.addToken(adrs.token1, adrs.rewardsPool1)

    let success: any = await offRamp
      .connect(signers[4])
      .executeSingleMessage.staticCall(
        ethers.encodeBytes32String('messageId'),
        77,
        '0x',
        adrs.controller,
        [
          { token: adrs.token1, amount: toEther(25) },
          { token: adrs.token2, amount: toEther(50) },
        ]
      )
    assert.equal(success, false)

    success = await offRamp
      .connect(signers[5])
      .executeSingleMessage.staticCall(
        ethers.encodeBytes32String('messageId'),
        77,
        '0x',
        adrs.controller,
        [{ token: adrs.token1, amount: toEther(25) }]
      )
    assert.equal(success, false)

    let rewardsPool2 = await deploy('RewardsPool', [adrs.sdlPool, adrs.token2])
    adrs.rewardsPool2 = await rewardsPool2.getAddress()

    await sdlPool.addToken(adrs.token2, adrs.rewardsPool2)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(ethers.encodeBytes32String('messageId'), 77, '0x', adrs.controller, [
        { token: adrs.token1, amount: toEther(30) },
        { token: adrs.token2, amount: toEther(60) },
      ])

    assert.equal(await controller.shouldUpdate(), false)
    assert.equal(fromEther(await token1.balanceOf(adrs.rewardsPool1)), 30)
    assert.equal(fromEther(await token2.balanceOf(adrs.rewardsPool2)), 60)
    assert.deepEqual(
      (await sdlPool.withdrawableRewards(accounts[0])).map((d) => fromEther(d)),
      [15, 30]
    )
    assert.deepEqual(
      (await sdlPool.withdrawableRewards(accounts[1])).map((d) => fromEther(d)),
      [15, 30]
    )

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(100),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await offRamp
      .connect(signers[4])
      .executeSingleMessage(ethers.encodeBytes32String('messageId'), 77, '0x', adrs.controller, [
        { token: adrs.token1, amount: toEther(30) },
        { token: adrs.token2, amount: toEther(60) },
      ])

    assert.equal(await controller.shouldUpdate(), true)
  })

  it('ccipReceive should work correctly for incoming updates', async () => {
    const { signers, adrs, controller, sdlToken, sdlPool, offRamp } = await loadFixture(
      deployFixture
    )

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(300),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await controller.executeUpdate(1)

    let success: any = await offRamp
      .connect(signers[5])
      .executeSingleMessage.staticCall(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [7]),
        adrs.controller,
        []
      )
    assert.equal(success, false)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [7]),
        adrs.controller,
        []
      )
    assert.equal(await controller.shouldUpdate(), false)

    await sdlPool.executeQueuedOperations([])
    assert.deepEqual(parseLock((await sdlPool.getLocks([7]))[0]), {
      amount: 300,
      boostAmount: 0,
      startTime: 0,
      duration: 0,
      expiry: 0,
    })
    assert.equal(await sdlPool.shouldUpdate(), false)
  })

  it('recoverTokens should work correctly', async () => {
    const { accounts, adrs, controller, sdlToken, linkToken } = await loadFixture(deployFixture)

    await linkToken.transfer(adrs.controller, toEther(1000))
    await sdlToken.transfer(adrs.controller, toEther(2000))
    await controller.recoverTokens(
      [adrs.linkToken, adrs.sdlToken],
      [toEther(1000), toEther(2000)],
      accounts[3]
    )

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1000)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[3])), 2000)
  })
})
