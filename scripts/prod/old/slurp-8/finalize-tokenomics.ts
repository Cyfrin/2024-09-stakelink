import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { getContract } from '../../utils/deployment'
import { getAccounts } from '../../utils/helpers'
import { StakingAllowance, Vesting } from '../../../typechain-types'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const linkPoolAddress = '0x6879826450e576b401c4ddeff2b7755b1e85d97c'
const linkPoolMintAmount = '10000000000000000000000000'

const linkPoolVestingMintAmount = '10000000000000000000000000'

const treasuryBurnAmount = '22033397960000000000000000'

const nopCount = 14
const mintAmountPerNop = '900000000000000000000000'

const generateNopTxs = async (sdlToken: StakingAllowance) => {
  let txs = []

  for (let i = 0; i < nopCount; i++) {
    let vesting = await getContract(`SDL_Vesting_NOP${i}`)
    txs.push({
      to: sdlToken.address,
      data: (await sdlToken.populateTransaction.mint(vesting.address, mintAmountPerNop)).data || '',
      value: '0',
    })
  }

  return txs
}

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

  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const linkPoolVesting = (await getContract('SDL_Vesting_LinkPool')) as Vesting

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: sdlToken.address,
      data:
        (await sdlToken.populateTransaction.mint(linkPoolAddress, linkPoolMintAmount)).data || '',
      value: '0',
    },
    {
      to: sdlToken.address,
      data:
        (
          await sdlToken.populateTransaction.mint(
            linkPoolVesting.address,
            linkPoolVestingMintAmount
          )
        ).data || '',
      value: '0',
    },
    {
      to: sdlToken.address,
      data: (await sdlToken.populateTransaction.burn(treasuryBurnAmount)).data || '',
      value: '0',
    },
    ...(await generateNopTxs(sdlToken)),
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
