// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Holds the shielded pool's USDC (BUILD_SPEC S5). Depositors pre-fund a commitment via
/// depositFor; only the NoteRegistry may consume that escrow or pay unshield recipients.
contract ShieldVault {
    IERC20 public immutable usdc;
    address public registry;
    address public immutable deployer;
    mapping(bytes32 => uint256) public pendingShield;

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

    function depositFor(bytes32 commitment, uint256 amount) external {
        require(commitment != bytes32(0), "vault: bad commitment");
        require(usdc.transferFrom(msg.sender, address(this), amount), "vault: pull failed");
        pendingShield[commitment] += amount;
    }

    function onShield(bytes32 commitment, uint256 amount) external onlyRegistry {
        uint256 pending = pendingShield[commitment];
        require(pending >= amount, "vault: no deposit");
        unchecked {
            pendingShield[commitment] = pending - amount;
        }
    }

    function onUnshield(address recipient, uint256 amount) external onlyRegistry {
        require(usdc.transfer(recipient, amount), "vault: pay failed");
    }
}
