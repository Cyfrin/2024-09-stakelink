import { ERC677 } from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
} from '../../../utils/deployment'

// SDL Token
const SDLTokenArgs = {
  name: 'stake.link', // SDL token name
  symbol: 'SDL', // SDL token symbol
}
// Linear Boost Controller
const LinearBoostControllerArgs = {
  minLockingDuration: 86400, // minimum locking duration
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration
  maxBoost: 8, // maximum boost amount
}
// SDL Pool Primary
const SDLPoolPrimaryArgs = {
  derivativeTokenName: 'Reward Escrowed SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'reSDL', // SDL staking derivative token symbol
}
// Delegator Pool (deprecated)
const DelegatorPool = {
  derivativeTokenName: 'Staked SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'stSDL', // SDL staking derivative token symbol
}

export async function deployCore() {
  const lplToken = (await getContract('LPLToken')) as ERC677

  const sdlToken = await deploy('StakingAllowance', [SDLTokenArgs.name, SDLTokenArgs.symbol])
  console.log('SDLToken deployed: ', sdlToken.target)

  const lplMigration = await deploy('LPLMigration', [lplToken.target, sdlToken.target])
  console.log('LPLMigration deployed: ', lplMigration.target)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.target,
    DelegatorPool.derivativeTokenName,
    DelegatorPool.derivativeTokenSymbol,
    [],
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.target)

  const lbc = await deploy('LinearBoostController', [
    LinearBoostControllerArgs.minLockingDuration,
    LinearBoostControllerArgs.maxLockingDuration,
    LinearBoostControllerArgs.maxBoost,
  ])
  console.log('LinearBoostController deployed: ', lbc.target)

  const sdlPoolPrimary = await deployUpgradeable('SDLPoolPrimary', [
    SDLPoolPrimaryArgs.derivativeTokenName,
    SDLPoolPrimaryArgs.derivativeTokenSymbol,
    sdlToken.target,
    lbc.target,
  ])
  console.log('SDLPool deployed: ', sdlPoolPrimary.target)

  await (await sdlPoolPrimary.setDelegatorPool(delegatorPool.target)).wait()

  updateDeployments(
    {
      SDLToken: sdlToken.target,
      LPLMigration: lplMigration.target,
      LinearBoostController: lbc.target,
      SDLPool: sdlPoolPrimary.target,
      DelegatorPool: delegatorPool.target,
    },
    { SDLToken: 'StakingAllowance', SDLPool: 'SDLPoolPrimary' }
  )
}
