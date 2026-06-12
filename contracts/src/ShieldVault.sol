// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Holds the shielded pool's USDC (BUILD_SPEC S5). Only the NoteRegistry may move funds:
/// cash_shield pulls from the depositor (pre-approved), cash_unshield pays the recipient.
contract ShieldVault {
    IERC20 public immutable usdc;
    address public registry;
    address public immutable deployer;

    constructor(IERC20 _usdc) {
        usdc = _usdc;
        deployer = msg.sender;
    }

    function setRegistry(address _registry) external {
        require(msg.sender == deployer && registry == address(0), "vault: registry set");
        registry = _registry;
    }

    modifier onlyRegistry() {
        require(msg.sender == registry, "vault: not registry");
        _;
    }

    function onShield(address depositor, uint256 amount) external onlyRegistry {
        require(usdc.transferFrom(depositor, address(this), amount), "vault: pull failed");
    }

    function onUnshield(address recipient, uint256 amount) external onlyRegistry {
        require(usdc.transfer(recipient, amount), "vault: pay failed");
    }
}
