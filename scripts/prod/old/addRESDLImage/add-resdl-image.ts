import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { SDLPool } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const sdlPoolImplementation = '0x88DD5C421f7B9FCdB83FD534bd83d22F8B80eA75'
const baseURI =
  'https://bronze-elderly-halibut-521.mypinata.cloud/ipfs/QmZexLPmRhNLYNTu7mpabt4aihp84vmoP1T2nYg4vqi7aU'

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

  const sdlPool = (await getContract('SDLPool')) as SDLPool

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: sdlPool.address,
      data: (await sdlPool.populateTransaction.upgradeTo(sdlPoolImplementation)).data || '',
      value: '0',
    },
    {
      to: sdlPool.address,
      data: (await sdlPool.populateTransaction.setBaseURI(baseURI)).data || '',
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
