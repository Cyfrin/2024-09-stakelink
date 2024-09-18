import { ethers } from 'hardhat'
import { getAccounts } from '../utils/helpers'

async function main() {
  const { accounts } = await getAccounts()

  let customHttpProvider = new ethers.providers.JsonRpcProvider(process.env.GETH_URL)

  let coinbase = await customHttpProvider.send('eth_coinbase', [])
  let coinbaseSigner = await customHttpProvider.getUncheckedSigner(coinbase)

  for (let i = 0; i < accounts.length; i++) {
    let signer = await ethers.provider.getSigner(i)
    let balance = await signer.getBalance()

    if (balance.gt(0)) {
      console.log(`Account ${await signer.getAddress()} already has a balance skipping`)
      continue
    }

    console.log('Sending 50 ETH to', await signer.getAddress())
    let txObj = {
      to: signer.getAddress(),
      value: ethers.utils.parseEther('50'),
    }
    let tx = await coinbaseSigner.sendTransaction(txObj)
    await tx.wait()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
