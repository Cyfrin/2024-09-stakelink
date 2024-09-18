import { ethers, upgrades } from 'hardhat'

export const toEther = (amount: string | number) => {
  return ethers.parseEther(amount.toString())
}

export const fromEther = (amount: bigint) => {
  return Number(ethers.formatEther(amount))
}

export const deploy = async (contractName: string, args: any[] = []) => {
  return ethers.deployContract(contractName, args) as any
}

export const attach = async (contractName: string, contractAddress: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  return Contract.attach(contractAddress)
}

export const deployUpgradeable = async (contractName: string, args: any[] = [], options = {}) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployProxy(Contract, args, { kind: 'uups', ...options }) as any
}

export const deployImplementation = async (contractName: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployImplementation(Contract, { kind: 'uups' })
}

export const getAccounts = async () => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer) => signer.getAddress()))
  return { signers, accounts }
}

export const setupToken = async (token: any, accounts: string[], allAccounts = false) => {
  return Promise.all(
    accounts.map((account, index) =>
      token.transfer(account, toEther(index < 4 || allAccounts ? 10000 : 0))
    )
  )
}

export const padBytes = (value: string, bytesLength: number) => {
  const toPad = bytesLength * 2 + 2 - value.length
  if (toPad == 0) {
    return value
  }
  return '0x' + '0'.repeat(toPad) + value.substring(2)
}

export const concatBytes = (values: string[]) => {
  return values.reduce((res, curr) => (res += curr.substring(2)), '0x')
}
