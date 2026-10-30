// Module core/crypto — CredentialVault (SRC-01, ADR-006), see docs/ARCHITECTURE.md §4.
export {
  createCredentialVault,
  credentialVault,
  VaultKeyLostError,
  type CredentialVault,
  type CredentialVaultDeps,
  type VaultKeyLostReason,
} from './vault';
// Password-based encryption of data leaving the device (EXP-01 export file).
export {
  base64ToBytes,
  bytesToBase64,
  decryptWithPassword,
  encryptWithPassword,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  PasswordDecryptError,
  type PasswordCipherDeps,
  type PasswordEnvelope,
} from './passwordCipher';
