import { SequencerVCS } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import hre from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { getAccounts } from '../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// Sequencer Vault
const SequencerVaultArgs = {
  pubkey: '', // sequencer pubkey
  signer: '', // sequencer signer
  rewardsReceiver: '', // address authorized to claim operator rewards
}

async function main() {
  const { accounts } = await getAccounts()

  const safeApiKit = new SafeApiKit({
    chainId: 1n,
    txServiceUrl: 'https://safe-transaction-mainnet.safe.global',
  })
  const safeSdk = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const sequencerVCS = (await getContract('SequencerVCS', true)) as SequencerVCS

  const transactions: MetaTransactionData[] = [
    {
      to: sequencerVCS.target.toString(),
      data:
        (
          await sequencerVCS.addVault.populateTransaction(
            SequencerVaultArgs.pubkey,
            SequencerVaultArgs.signer,
            SequencerVaultArgs.rewardsReceiver
          )
        ).data || '',
      value: '0',
    },
  ]
  const safeTransaction = await safeSdk.createTransaction({ transactions })
  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction)
  const senderSignature = await safeSdk.signHash(safeTxHash)

  await safeApiKit.proposeTransaction({
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
