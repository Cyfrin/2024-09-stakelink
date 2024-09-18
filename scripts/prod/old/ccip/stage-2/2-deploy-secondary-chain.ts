import { toEther } from '../../../../utils/helpers'
import {
  updateDeployments,
  deploy,
  deployUpgradeable,
  getContract,
} from '../../../../utils/deployment'
import {
  RESDLTokenBridge,
  SDLPoolCCIPControllerSecondary,
  SDLPoolSecondary,
} from '../../../../../typechain-types'

// Execute on Arbitrum Mainnet

const ccipRouter = '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8'
const multisigAddress = ''

const primaryChainSelector = '5009297550715157269' // ETH Mainnet
const primaryChainSDLPoolCCIPController = '' // ETH Mainnet

// Linear Boost Controller
const LinearBoostControllerParams = {
  minLockingDuration: 86400, // minimum locking duration in seconds
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration
  maxBoost: 8, // maximum boost amount
}
// SDL Pool Secondary
const SDLPoolParams = {
  derivativeTokenName: 'Reward Escrowed SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'reSDL', // SDL staking derivative token symbol
  queuedNewLockLimit: 50, // max number of queued new locks a user can have at once
  baseURI: '', // base URI for reSDL NFTs
}
// SDL Pool CCIP Controller Secondary
const SDLPoolCCIPControllerParams = {
  maxLINKFee: toEther(10), // max LINK fee to be paid on outgoing CCIP updates
  updateInitiator: '', // address authorized to send CCIP updates
  minTimeBetweenUpdates: '82800', // min time between updates in seconds
}

async function main() {
  const sdlToken = await getContract('SDLToken')
  const linkToken = await getContract('LINKToken')
  const wstLINKToken = await getContract('LINK_WrappedSDToken')

  const boostController = await deploy('LinearBoostController', [
    LinearBoostControllerParams.minLockingDuration,
    LinearBoostControllerParams.maxLockingDuration,
    LinearBoostControllerParams.maxBoost,
  ])
  console.log('LinearBoostController deployed: ', boostController.address)

  const sdlPool = (await deployUpgradeable('SDLPoolSecondary', [
    SDLPoolParams.derivativeTokenName,
    SDLPoolParams.derivativeTokenSymbol,
    sdlToken.address,
    boostController.address,
    SDLPoolParams.queuedNewLockLimit,
  ])) as SDLPoolSecondary
  console.log('SDLPoolSecondary deployed: ', sdlPool.address)

  const rewardsPool = await deploy('RewardsPool', [sdlPool.address, wstLINKToken.address])
  console.log('wstLINK_SDLRewardsPool deployed: ', rewardsPool.address)

  const ccipController = (await deploy('SDLPoolCCIPControllerSecondary', [
    ccipRouter,
    linkToken.address,
    sdlToken.address,
    sdlPool.address,
    primaryChainSelector,
    primaryChainSDLPoolCCIPController,
    SDLPoolCCIPControllerParams.maxLINKFee,
    SDLPoolCCIPControllerParams.updateInitiator,
    SDLPoolCCIPControllerParams.minTimeBetweenUpdates,
  ])) as SDLPoolCCIPControllerSecondary
  console.log('SDLPoolCCIPControllerSecondary deployed: ', ccipController.address)

  const reSDLTokenBridge = (await deploy('RESDLTokenBridge', [
    linkToken.address,
    sdlToken.address,
    sdlPool.address,
    ccipController.address,
  ])) as RESDLTokenBridge
  console.log('RESDLTokenBridge deployed: ', reSDLTokenBridge.address)

  await (await boostController.transferOwnership(multisigAddress)).wait()

  await (await sdlPool.setCCIPController(ccipController.address)).wait()
  await (await sdlPool.addToken(wstLINKToken.address, rewardsPool.address)).wait()
  await (await sdlPool.setBaseURI(SDLPoolParams.baseURI)).wait()
  await (await sdlPool.transferOwnership(multisigAddress)).wait()

  await (await ccipController.setRESDLTokenBridge(reSDLTokenBridge.address)).wait()
  await (await ccipController.transferOwnership(multisigAddress)).wait()

  updateDeployments(
    {
      SDLPoolSecondary: sdlPool.address,
      LinearBoostController: boostController.address,
      wstLINK_SDLRewardsPool: rewardsPool.address,
      SDLPoolCCIPControllerSecondary: ccipController.address,
      RESDLTokenBridge: reSDLTokenBridge.address,
    },
    { wstLINK_SDLRewardsPool: 'RewardsPool' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
