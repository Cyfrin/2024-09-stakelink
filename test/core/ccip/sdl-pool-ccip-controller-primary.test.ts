import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SDLPoolPrimary,
  SDLPoolCCIPControllerPrimary,
  Router,
} from '../../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const parseLock = (lock: any) => ({
  amount: fromEther(lock[0]),
  boostAmount: Number(fromEther(lock[1]).toFixed(4)),
  startTime: Number(lock[2]),
  duration: Number(lock[3]),
  expiry: Number(lock[4]),
})

describe('SDLPoolCCIPControllerPrimary', () => {
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

    const router = (await deploy('Router', [accounts[0], await armProxy.getAddress()])) as Router
    adrs.router = await router.getAddress()

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
      adrs.router,
      [adrs.token1, adrs.token2],
      [adrs.tokenPool, adrs.tokenPool2],
    ])) as CCIPOffRampMock
    adrs.offRamp = await offRamp.getAddress()

    await router.applyRampUpdates(
      [{ destChainSelector: 77, onRamp: adrs.onRamp }],
      [],
      [{ sourceChainSelector: 77, offRamp: adrs.offRamp }]
    )

    let boostController = await deploy('LinearBoostController', [10, 4 * 365 * 86400, 4])
    const sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'reSDL',
      'reSDL',
      adrs.sdlToken,
      await boostController.getAddress(),
    ])) as SDLPoolPrimary
    adrs.sdlPool = await sdlPool.getAddress()

    const controller = (await deploy('SDLPoolCCIPControllerPrimary', [
      adrs.router,
      adrs.linkToken,
      adrs.sdlToken,
      adrs.sdlPool,
      toEther(10),
      accounts[0],
    ])) as SDLPoolCCIPControllerPrimary
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

    await sdlPool.setCCIPController(adrs.controller)
    await controller.setRESDLTokenBridge(accounts[5])
    await controller.setRebaseController(accounts[0])
    await controller.addWhitelistedChain(77, accounts[4])

    return {
      signers,
      accounts,
      adrs,
      linkToken,
      sdlToken,
      token1,
      token2,
      router,
      tokenPool,
      tokenPool2,
      onRamp,
      offRamp,
      sdlPool,
      controller,
    }
  }

  it('handleOutgoingRESDL should work correctly', async () => {
    const { signers, accounts, adrs, sdlToken, sdlPool, controller } = await loadFixture(
      deployFixture
    )

    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(200),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    let ts = (await ethers.provider.getBlock('latest'))?.timestamp

    await expect(
      controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[1], 3)
    ).to.be.revertedWithCustomError(controller, 'SenderNotAuthorized()')

    assert.deepEqual(
      await controller
        .connect(signers[5])
        .handleOutgoingRESDL.staticCall(77, accounts[0], 3)
        .then((d: any) => [d[0], parseLock(d[1])]),
      [
        accounts[4],
        { amount: 200, boostAmount: 200, startTime: ts, duration: 365 * 86400, expiry: 0 },
      ]
    )

    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 3)
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.controller)), 200)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 400)
    await expect(sdlPool.ownerOf(3)).to.be.revertedWithCustomError(sdlPool, 'InvalidLockId()')
  })

  it('handleIncomingRESDL should work correctly', async () => {
    const { signers, accounts, adrs, sdlToken, sdlPool, controller } = await loadFixture(
      deployFixture
    )

    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)

    await controller.connect(signers[5]).handleIncomingRESDL(77, accounts[3], 1, {
      amount: toEther(100),
      boostAmount: toEther(100),
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.controller)), 0)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.sdlPool)), 300)
    assert.equal(await sdlPool.ownerOf(1), accounts[3])
    assert.deepEqual(parseLock((await sdlPool.getLocks([1]))[0]), {
      amount: 100,
      boostAmount: 100,
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
  })

  it('adding/removing whitelisted chains should work correctly', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    await controller.addWhitelistedChain(88, accounts[6])

    assert.deepEqual(
      (await controller.getWhitelistedChains()).map((d) => Number(d)),
      [77, 88]
    )
    assert.equal(await controller.whitelistedDestinations(77), accounts[4])
    assert.equal(await controller.whitelistedDestinations(88), accounts[6])

    await expect(controller.addWhitelistedChain(77, accounts[7])).to.be.revertedWithCustomError(
      controller,
      'AlreadyAdded()'
    )
    await expect(
      controller.addWhitelistedChain(99, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(controller, 'InvalidDestination()')

    await controller.removeWhitelistedChain(77)
    assert.deepEqual(
      (await controller.getWhitelistedChains()).map((d) => Number(d)),
      [88]
    )
    assert.equal(await controller.whitelistedDestinations(77), ethers.ZeroAddress)

    await expect(controller.removeWhitelistedChain(77)).to.be.revertedWithCustomError(
      controller,
      'InvalidDestination()'
    )
  })

  it('distributeRewards should work correctly', async () => {
    const {
      signers,
      accounts,
      adrs,
      sdlToken,
      sdlPool,
      controller,
      token1,
      token2,
      onRamp,
      linkToken,
      router,
    } = await loadFixture(deployFixture)

    let rewardsPool1 = await deploy('RewardsPool', [adrs.sdlPool, adrs.token1])
    adrs.rewardsPool1 = await rewardsPool1.getAddress()

    await sdlPool.addToken(adrs.token1, adrs.rewardsPool1)
    await controller.approveRewardTokens([adrs.token1, adrs.token2])
    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)
    await token1.transferAndCall(adrs.rewardsPool1, toEther(50), '0x')
    await controller.distributeRewards([1, 2])

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[4]
    )
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.equal(
      requestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [[adrs.token1, 25]]
    )
    assert.equal(fromEther(await token1.balanceOf(adrs.tokenPool)), 25)

    let tokenPool88 = (await deploy('CCIPTokenPoolMock', [adrs.token1])) as CCIPTokenPoolMock
    adrs.tokenPool88 = await tokenPool88.getAddress()

    let tokenPool288 = (await deploy('CCIPTokenPoolMock', [adrs.token2])) as CCIPTokenPoolMock
    adrs.tokenPool288 = await tokenPool288.getAddress()

    let onRamp88 = (await deploy('CCIPOnRampMock', [
      [adrs.token1, adrs.token2],
      [adrs.tokenPool88, adrs.tokenPool288],
      adrs.linkToken,
    ])) as CCIPOnRampMock
    adrs.onRamp88 = await onRamp88.getAddress()

    let offRamp88 = (await deploy('CCIPOffRampMock', [
      adrs.router,
      [adrs.token1, adrs.token2],
      [adrs.tokenPool88, adrs.tokenPool288],
    ])) as CCIPOffRampMock
    adrs.offRamp88 = await offRamp88.getAddress()

    await router.applyRampUpdates(
      [{ destChainSelector: 88, onRamp: adrs.onRamp88 }],
      [],
      [{ sourceChainSelector: 88, offRamp: adrs.offRamp88 }]
    )

    let rewardsPool2 = await deploy('RewardsPool', [adrs.sdlPool, adrs.token2])
    adrs.rewardsPool2 = await rewardsPool2.getAddress()

    await sdlPool.addToken(adrs.token2, adrs.rewardsPool2)
    await controller.addWhitelistedChain(88, accounts[7])
    await sdlToken.transferAndCall(
      adrs.sdlPool,
      toEther(400),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await controller.connect(signers[5]).handleOutgoingRESDL(88, accounts[0], 3)
    await token1.transferAndCall(adrs.rewardsPool1, toEther(200), '0x')
    await token2.transferAndCall(adrs.rewardsPool2, toEther(300), '0x')
    await controller.distributeRewards([3, 4])

    requestData = await onRamp.getLastRequestData()
    requestMsg = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 94)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[4]
    )
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.equal(
      requestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [3]).slice(2)
    )
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [
        [adrs.token1, 50],
        [adrs.token2, 75],
      ]
    )
    assert.equal(fromEther(await token1.balanceOf(adrs.tokenPool)), 75)
    assert.equal(fromEther(await token2.balanceOf(adrs.tokenPool2)), 75)

    requestData = await onRamp88.getLastRequestData()
    requestMsg = await onRamp88.getLastRequestMessage()
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[7]
    )
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.equal(
      requestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [4]).slice(2)
    )
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [
        [adrs.token1, 100],
        [adrs.token2, 150],
      ]
    )
    assert.equal(fromEther(await token1.balanceOf(adrs.tokenPool88)), 100)
    assert.equal(fromEther(await token2.balanceOf(adrs.tokenPool288)), 150)
  })

  it('distributeRewards should work correctly with wrapped tokens', async () => {
    const { signers, accounts, adrs, sdlPool, controller, onRamp, offRamp, token1, linkToken } =
      await loadFixture(deployFixture)

    let wToken = await deploy('WrappedSDTokenMock', [adrs.token1])
    adrs.wToken = await wToken.getAddress()

    let rewardsPool = await deploy('RewardsPoolWSD', [adrs.sdlPool, adrs.token1, adrs.wToken])
    adrs.rewardsPool = await rewardsPool.getAddress()

    await sdlPool.addToken(adrs.token1, adrs.rewardsPool)
    await controller.approveRewardTokens([adrs.wToken])
    await controller.setWrappedRewardToken(adrs.token1, adrs.wToken)
    await onRamp.setTokenPool(adrs.wToken, adrs.tokenPool)
    await offRamp.setTokenPool(adrs.wToken, adrs.tokenPool)
    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)
    await token1.transferAndCall(adrs.rewardsPool, toEther(500), '0x')
    await controller.distributeRewards([1, 2])

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[4]
    )
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [[adrs.wToken, 125]]
    )
    assert.equal(fromEther(await wToken.balanceOf(adrs.tokenPool)), 125)
  })

  it('ccipReceive should work correctly', async () => {
    const { signers, accounts, adrs, sdlPool, controller, offRamp, router } = await loadFixture(
      deployFixture
    )

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [3, toEther(1000)]),
        adrs.controller,
        []
      )

    assert.equal(Number(await sdlPool.lastLockId()), 5)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 1000)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(adrs.controller)), 1000)
    assert.deepEqual(
      await controller.getQueuedUpdates().then((d) => d.map((v) => [Number(v[0]), Number(v[1])])),
      [[77, 3]]
    )

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [0, toEther(-100)]),
        adrs.controller,
        []
      )

    assert.equal(Number(await sdlPool.lastLockId()), 5)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 900)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(adrs.controller)), 900)
    assert.deepEqual(
      await controller.getQueuedUpdates().then((d) => d.map((v) => [Number(v[0]), Number(v[1])])),
      [
        [77, 3],
        [77, 0],
      ]
    )

    await controller.addWhitelistedChain(88, accounts[6])
    let onRamp88 = (await deploy('CCIPOnRampMock', [[], [], adrs.linkToken])) as CCIPOnRampMock
    adrs.onRamp88 = await onRamp88.getAddress()

    let offRamp88 = (await deploy('CCIPOffRampMock', [adrs.router, [], []])) as CCIPOffRampMock
    adrs.offRamp88 = await offRamp88.getAddress()

    await router.applyRampUpdates(
      [{ destChainSelector: 88, onRamp: adrs.onRamp88 }],
      [],
      [{ sourceChainSelector: 88, offRamp: adrs.offRamp88 }]
    )
    await offRamp88
      .connect(signers[6])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        88,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [2, toEther(200)]),
        adrs.controller,
        []
      )

    assert.equal(Number(await sdlPool.lastLockId()), 7)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(88)), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(adrs.controller)), 1100)
    assert.deepEqual(
      await controller.getQueuedUpdates().then((d) => d.map((v) => [Number(v[0]), Number(v[1])])),
      [
        [77, 3],
        [77, 0],
        [88, 6],
      ]
    )
  })

  it('executeQueuedUpdates should work correctly', async () => {
    const { signers, accounts, adrs, controller, offRamp, router, onRamp, linkToken } =
      await loadFixture(deployFixture)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [3, toEther(1000)]),
        adrs.controller,
        []
      )

    await controller.executeQueuedUpdates([1])

    assert.deepEqual(await controller.getQueuedUpdates(), [])

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[4]
    )
    assert.equal(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], requestMsg[1])[0], 3)
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.equal(
      requestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2)
    )

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        77,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [0, toEther(-100)]),
        adrs.controller,
        []
      )

    await controller.addWhitelistedChain(88, accounts[6])

    let onRamp88 = (await deploy('CCIPOnRampMock', [[], [], adrs.linkToken])) as CCIPOnRampMock
    adrs.onRamp88 = await onRamp88.getAddress()

    let offRamp88 = (await deploy('CCIPOffRampMock', [adrs.router, [], []])) as CCIPOffRampMock
    adrs.offRamp88 = await offRamp88.getAddress()

    await router.applyRampUpdates(
      [{ destChainSelector: 88, onRamp: adrs.onRamp88 }],
      [],
      [{ sourceChainSelector: 88, offRamp: adrs.offRamp88 }]
    )
    await offRamp88
      .connect(signers[6])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        88,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'int256'], [2, toEther(200)]),
        adrs.controller,
        []
      )

    await controller.executeQueuedUpdates([1, 2])

    assert.deepEqual(await controller.getQueuedUpdates(), [])

    requestData = await onRamp88.getLastRequestData()
    requestMsg = await onRamp88.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(adrs.controller)), 94)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], adrs.controller)
    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], requestMsg[0])[0],
      accounts[6]
    )
    assert.equal(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], requestMsg[1])[0], 6)
    assert.equal(requestMsg[3], adrs.linkToken)
    assert.equal(
      requestMsg[4],
      '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [2]).slice(2)
    )

    await expect(controller.executeQueuedUpdates([1])).to.be.revertedWithCustomError(
      controller,
      'InvalidLength()'
    )
  })

  it('recoverTokens should work correctly', async () => {
    const { accounts, adrs, controller, linkToken, sdlToken } = await loadFixture(deployFixture)

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
