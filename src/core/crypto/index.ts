// Module core/crypto — CredentialVault (SRC-01, ADR-006), see docs/ARCHITECTURE.md §4.
export {
  createCredentialVault,
  credentialVault,
  VaultKeyLostError,
  type CredentialVault,
  type CredentialVaultDeps,
  type VaultKeyLostReason,
} from './vault';
