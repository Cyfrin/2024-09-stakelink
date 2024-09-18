import { WrappedTokenBridge } from '../../../../../typechain-types'
import { updateDeployments, deploy, getContract } from '../../../../utils/deployment'

// should be deployed on primary chain (Ethereum Mainnet)

const ccipRouter = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

async function main() {
  const linkToken = await getContract('LINKToken')
  const stLINKToken = await getContract('LINK_StakingPool')
  const wstLINKToken = await getContract('LINK_WrappedSDToken')

  const wrappedTokenBridge = (await deploy('WrappedTokenBridge', [
    ccipRouter,
    linkToken.address,
    stLINKToken.address,
    wstLINKToken.address,
  ])) as WrappedTokenBridge
  console.log('stLINK_WrappedTokenBridge deployed: ', wrappedTokenBridge.address)

  await (await wrappedTokenBridge.transferOwnership(multisigAddress)).wait()

  updateDeployments(
    {
      stLINK_WrappedTokenBridge: wrappedTokenBridge.address,
    },
    { stLINK_WrappedTokenBridge: 'WrappedTokenBridge' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
