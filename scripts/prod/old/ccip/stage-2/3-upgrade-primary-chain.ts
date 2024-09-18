import { getContract } from '../../../../utils/deployment'
import { SDLPoolCCIPControllerPrimary, SDLPoolPrimary } from '../../../../../typechain-types'
import { getAccounts } from '../../../../utils/helpers'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { ethers } from 'hardhat'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'

// Execute on Ethereum Mainnet

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const secondaryChainSelector = '4949039107694359620' // Arbitrum Mainnet
const secondaryChainSDLPoolCCIPController = '' // Arbitrum Mainnet
const sdlPoolPrimaryImplementation = ''

async function main() {
  const { signers, accounts } = await getAccounts()
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signers[0],
  })
  const safeSdk = await Safe.create({ ethAdapter, safeAddress: multisigAddress })
  const safeService = new SafeApiKit({
    txServiceUrl: 'https://safe-transaction-mainnet.safe.global',
    ethAdapter,
  })

  const sdlPool = (await getContract('SDLPool')) as SDLPoolPrimary
  const ccipController = (await getContract(
    'SDLPoolCCIPControllerPrimary'
  )) as SDLPoolCCIPControllerPrimary

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: sdlPool.address,
      data:
        (
          await sdlPool.populateTransaction.upgradeToAndCall(
            sdlPoolPrimaryImplementation,
            sdlPool.interface.encodeFunctionData('initialize', [
              '',
              '',
              ethers.constants.AddressZero,
              ethers.constants.AddressZero,
            ])
          )
        ).data || '',
      value: '0',
    },
    {
      to: sdlPool.address,
      data:
        (await sdlPool.populateTransaction.setCCIPController(ccipController.address)).data || '',
      value: '0',
    },
    {
      to: ccipController.address,
      data:
        (
          await ccipController.populateTransaction.addWhitelistedChain(
            secondaryChainSelector,
            secondaryChainSDLPoolCCIPController
          )
        ).data || '',
      value: '0',
    },
  ]
  const safeTransaction = await safeSdk.createTransaction({ safeTransactionData })
  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction)
  const senderSignature = await safeSdk.signTransactionHash(safeTxHash)

  await safeService.proposeTransaction({
    safeAddress: multisigAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: accounts[0],
    senderSignature: senderSignature.data,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
