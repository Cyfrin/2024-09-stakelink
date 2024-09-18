import { toEther } from '../../../../utils/helpers'
import { updateDeployments, deploy } from '../../../../utils/deployment'
import { RewardsInitiator, SDLPoolCCIPControllerPrimary } from '../../../../../typechain-types'
import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../../../utils/deployment'

// Execute on Ethereum Mainnet

const ccipRouter = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// Linear Boost Controller
const LinearBoostControllerParams = {
  minLockingDuration: 86400, // minimum locking duration in seconds
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration in seconds
  maxBoost: 8, // maximum boost amount
}
// SDL Pool CCIP Controller Primary
const SDLPoolCCIPControllerParams = {
  maxLINKFee: toEther(10), //  max LINK fee to paid on outgoing CCIP updates
  updateInitiator: '', // address authorized to send CCIP updates
}
// Rewards Initiator
const RewardsInitiatorParams = {
  whitelistedCaller: '', // address authorized to initiate rebase and rewards distribution
}

async function main() {
  const sdlPool = await getContract('SDLPool')
  const sdlToken = await getContract('SDLToken')
  const linkToken = await getContract('LINKToken')
  const wstLINKToken = await getContract('LINK_WrappedSDToken')
  const stakingPool = await getContract('LINK_StakingPool')

  const boostController = await deploy('LinearBoostController', [
    LinearBoostControllerParams.minLockingDuration,
    LinearBoostControllerParams.maxLockingDuration,
    LinearBoostControllerParams.maxBoost,
  ])
  console.log('LinearBoostController deployed: ', boostController.address)

  const sdlPoolPrimaryImp = (await upgrades.prepareUpgrade(
    sdlPool.address,
    await ethers.getContractFactory('SDLPoolPrimary'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('SDLPoolPrimary implementation deployed at: ', sdlPoolPrimaryImp)

  const ccipController = (await deploy('SDLPoolCCIPControllerPrimary', [
    ccipRouter,
    linkToken.address,
    sdlToken.address,
    sdlPool.address,
    SDLPoolCCIPControllerParams.maxLINKFee,
    SDLPoolCCIPControllerParams.updateInitiator,
  ])) as SDLPoolCCIPControllerPrimary
  console.log('SDLPoolCCIPControllerPrimary deployed: ', ccipController.address)

  const reSDLTokenBridge = await deploy('RESDLTokenBridge', [
    linkToken.address,
    sdlToken.address,
    sdlPool.address,
    ccipController.address,
  ])
  console.log('RESDLTokenBridge deployed: ', reSDLTokenBridge.address)

  const rewardsInitiator = (await deploy('RewardsInitiator', [
    stakingPool.address,
    ccipController.address,
  ])) as RewardsInitiator
  console.log('RewardsInitiator deployed: ', rewardsInitiator.address)

  updateDeployments({
    LinearBoostController: boostController.address,
    SDLPoolCCIPControllerPrimary: ccipController.address,
    RESDLTokenBridge: reSDLTokenBridge.address,
    RewardsInitiator: rewardsInitiator.address,
  })

  await (await boostController.transferOwnership(multisigAddress)).wait()

  await (
    await rewardsInitiator.whitelistCaller(RewardsInitiatorParams.whitelistedCaller, true)
  ).wait()
  await (await rewardsInitiator.transferOwnership(multisigAddress)).wait()

  await (
    await ccipController.setWrappedRewardToken(stakingPool.address, wstLINKToken.address)
  ).wait()
  await (await ccipController.approveRewardTokens([wstLINKToken.address])).wait()
  await (await ccipController.setRESDLTokenBridge(reSDLTokenBridge.address)).wait()
  await (await ccipController.setRebaseController(rewardsInitiator.address)).wait()
  await (await ccipController.transferOwnership(multisigAddress)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
