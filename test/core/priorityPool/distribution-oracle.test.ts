import { toEther, deploy, fromEther, getAccounts } from '../../utils/helpers'
import { assert, expect } from 'chai'
import { ERC677, DistributionOracle, PriorityPoolMock, Operator } from '../../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture, mineUpTo, time } from '@nomicfoundation/hardhat-network-helpers'
import cbor from 'cbor'

describe('DistributionOracle', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    const pp = (await deploy('PriorityPoolMock', [toEther(1000)])) as PriorityPoolMock
    adrs.pp = await pp.getAddress()

    const opContract = (await deploy('Operator', [adrs.token, accounts[0]])) as Operator
    adrs.opContract = await opContract.getAddress()

    const oracle = (await deploy('DistributionOracle', [
      adrs.token,
      adrs.opContract,
      '0x' + Buffer.from('64797f2053684fef80138a5be83281b1').toString('hex'),
      toEther(1),
      0,
      toEther(100),
      10,
      adrs.pp,
    ])) as DistributionOracle
    adrs.oracle = await oracle.getAddress()

    await opContract.setAuthorizedSenders([accounts[0]])
    await token.transfer(adrs.oracle, toEther(100))
    await oracle.toggleManualVerification()

    return { accounts, adrs, token, pp, opContract, oracle }
  }

  it('pauseForUpdate should work correctly', async () => {
    const { oracle } = await loadFixture(deployFixture)

    await oracle.pauseForUpdate()

    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber))?.timestamp

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => Number(v)),
      [ts, blockNumber, 0]
    )

    await expect(oracle.pauseForUpdate()).to.be.revertedWith('Pausable: paused')
  })

  it('requestUpdate should work correctly', async () => {
    const { oracle, opContract } = await loadFixture(deployFixture)

    await expect(oracle.requestUpdate()).to.be.revertedWithCustomError(oracle, 'NotPaused()')

    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber))?.timestamp

    await expect(oracle.requestUpdate()).to.be.revertedWithCustomError(
      oracle,
      'InsufficientBlockConfirmations()'
    )

    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => Number(v)),
      [ts, blockNumber, 1]
    )

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    assert.deepEqual(cbor.decodeAllSync(event[8].slice(2)), ['blockNumber', blockNumber])

    await expect(oracle.requestUpdate()).to.be.revertedWithCustomError(
      oracle,
      'RequestInProgress()'
    )
  })

  it('fulfillRequest should work correctly', async () => {
    const { oracle, opContract, pp } = await loadFixture(deployFixture)

    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber))?.timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.encodeBytes32String('merkle'),
          ethers.encodeBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => Number(v)),
      [ts, blockNumber, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String('merkle'))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String('ipfs'))
    assert.equal(fromEther(await pp.amountDistributed()), 1000)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 500)
  })

  it('manual verification should work correctly', async () => {
    const { oracle, opContract, pp } = await loadFixture(deployFixture)

    await oracle.toggleManualVerification()
    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber))?.timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args

    await expect(oracle.executeManualVerification()).to.be.revertedWithCustomError(
      oracle,
      'NoVerificationPending()'
    )

    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.encodeBytes32String('merkle'),
          ethers.encodeBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    await expect(oracle.requestUpdate()).to.be.revertedWithCustomError(
      oracle,
      'AwaitingManualVerification()'
    )
    await expect(oracle.pauseForUpdate()).to.be.revertedWithCustomError(
      oracle,
      'AwaitingManualVerification()'
    )

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => Number(v)),
      [ts, blockNumber, 0]
    )
    assert.equal(Number(await oracle.awaitingManualVerification()), 1)
    assert.deepEqual(
      await oracle.updateData().then((d) => [d[0], d[1], fromEther(d[2]), fromEther(d[3])]),
      [ethers.encodeBytes32String('merkle'), ethers.encodeBytes32String('ipfs'), 1000, 500]
    )
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String(''))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String(''))
    assert.equal(fromEther(await pp.amountDistributed()), 0)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 0)

    await oracle.executeManualVerification()

    assert.equal(Number(await oracle.awaitingManualVerification()), 0)
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String('merkle'))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String('ipfs'))
    assert.equal(fromEther(await pp.amountDistributed()), 1000)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 500)
  })

  it('cancelRequest should work correctly', async () => {
    const { oracle, opContract, pp } = await loadFixture(deployFixture)

    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts: any = (await ethers.provider.getBlock(blockNumber))?.timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()
    await time.increaseTo(ts + 1000000)

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await oracle.cancelRequest(event[2], event[6])

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => Number(v)),
      [ts, blockNumber, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.encodeBytes32String(''))
    assert.equal(await pp.ipfsHash(), ethers.encodeBytes32String(''))
    assert.equal(fromEther(await pp.amountDistributed()), 0)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 0)
  })

  it('withdrawLink should work correctly', async () => {
    const { accounts, adrs, oracle, token } = await loadFixture(deployFixture)

    await oracle.withdrawLink(toEther(20))
    assert.equal(fromEther(await token.balanceOf(adrs.oracle)), 80)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), 999999920)
  })

  it('checkUpkeep should work correctly', async () => {
    const { oracle, opContract } = await loadFixture(deployFixture)

    let data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))

    await oracle.pauseForUpdate()

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let blockNumber = await ethers.provider.getBlockNumber()
    await mineUpTo(blockNumber + 10)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]))

    await oracle.requestUpdate()

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.encodeBytes32String('merkle'),
          ethers.encodeBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))

    await oracle.setUpdateParams(0, toEther(1001), 0)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    await oracle.setUpdateParams(10000, toEther(1000), 0)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let ts: any = (await ethers.provider.getBlock(blockNumber))?.timestamp
    await time.increaseTo(ts + 1000000)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))
  })

  it('performUpkeep should work correctly', async () => {
    const { oracle, opContract } = await loadFixture(deployFixture)

    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]))
    ).to.be.revertedWithCustomError(oracle, 'NotPaused()')

    await oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))

    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))
    ).to.be.revertedWith('Pausable: paused')
    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]))
    ).to.be.revertedWithCustomError(oracle, 'InsufficientBlockConfirmations()')

    let blockNumber = await ethers.provider.getBlockNumber()
    await mineUpTo(blockNumber + 10)

    await oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]))

    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1]))
    ).to.be.revertedWithCustomError(oracle, 'RequestInProgress()')

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.encodeBytes32String('merkle'),
          ethers.encodeBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    await oracle.setUpdateParams(0, toEther(1001), 0)

    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))
    ).to.be.revertedWithCustomError(oracle, 'UpdateConditionsNotMet()')

    await oracle.setUpdateParams(10000, toEther(1000), 0)

    await expect(
      oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))
    ).to.be.revertedWithCustomError(oracle, 'UpdateConditionsNotMet')

    let ts: any = (await ethers.provider.getBlock(blockNumber))?.timestamp
    await time.increaseTo(ts + 1000000)

    await oracle.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]))
  })
})
