package vn.brainrot.parental.tv;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Ed25519 device identity for the AMS gateway (RFC 8032 "pure" Ed25519, 64 byte signatures).
 *
 * Why not AndroidKeyStore Ed25519 directly: per Android docs the Keystore only offers Ed25519 from Android 13
 * (API 33) and only on devices whose KeyMint implements it, while this app has minSdk 24 and Android TV boxes
 * commonly run Android 9..12. So the signature is computed in-process with BouncyCastle (already bundled in the
 * APK through bcpkix-jdk18on 1.79; classes.dex of 1.0.39 contains org/bouncycastle/crypto/signers/Ed25519Signer),
 * and the 32 byte seed is stored encrypted with an AES-256-GCM key that lives in AndroidKeyStore (API 23+, hardware
 * backed where the TV has a TEE). If AndroidKeyStore is unusable (some cheap TV firmware) the seed falls back to a
 * private file in getNoBackupFilesDir(): protection() then reports "software".
 */
final class AmsKeys {
    private static final String KS = "AndroidKeyStore";
    private static final String ALIAS = "brainrot_ams_seed_wrap";
    private static final String FILE = "ams_ed25519.seed";
    private static final byte FMT_PLAIN = 0;
    private static final byte FMT_KEYSTORE_GCM = 1;
    private static AmsKeys cached;

    private final Ed25519PrivateKeyParameters priv;
    private final byte[] pub;
    private final String protection;

    private AmsKeys(byte[] seed, String protection) {
        if (seed == null || seed.length != 32) throw new IllegalArgumentException("seed phai 32 byte");
        this.priv = new Ed25519PrivateKeyParameters(seed, 0);
        this.pub = priv.generatePublicKey().getEncoded();
        this.protection = protection;
    }

    /** Pure function, used by the JVM self-check with the vector in docs/DEVICE-PROTOCOL.md section 3.4. */
    static AmsKeys fromSeed(byte[] seed) { return new AmsKeys(seed, "memory"); }

    static synchronized AmsKeys load(Context ctx) {
        if (cached != null) return cached;
        File f = new File(ctx.getNoBackupFilesDir(), FILE);
        byte[] seed = null;
        String protection = "software";
        try {
            if (f.isFile()) {
                byte[] raw = readAll(f);
                if (raw.length == 33 && raw[0] == FMT_PLAIN) {
                    seed = Arrays.copyOfRange(raw, 1, 33);
                } else if (raw.length > 13 && raw[0] == FMT_KEYSTORE_GCM) {
                    seed = unwrap(Arrays.copyOfRange(raw, 1, raw.length));
                    protection = "keystore-wrapped";
                }
            }
        } catch (Exception unreadable) {
            seed = null; // Keystore wiped or file damaged: a new identity is created below (new device_id after register).
        }
        if (seed == null || seed.length != 32) {
            seed = new byte[32];
            new SecureRandom().nextBytes(seed);
            byte[] wrapped = null;
            try { wrapped = wrap(seed); } catch (Exception keystoreUnavailable) { /* fall through to software */ }
            try {
                byte[] out;
                if (wrapped != null) {
                    out = new byte[wrapped.length + 1];
                    out[0] = FMT_KEYSTORE_GCM;
                    System.arraycopy(wrapped, 0, out, 1, wrapped.length);
                    protection = "keystore-wrapped";
                } else {
                    out = new byte[33];
                    out[0] = FMT_PLAIN;
                    System.arraycopy(seed, 0, out, 1, 32);
                    protection = "software";
                }
                writeAll(f, out);
            } catch (Exception cannotPersist) {
                throw new IllegalStateException("Khong luu duoc khoa thiet bi AMS", cannotPersist);
            }
        }
        cached = new AmsKeys(seed, protection);
        Arrays.fill(seed, (byte) 0);
        return cached;
    }

    String protection() { return protection; }

    /** 32 byte public key, base64url without padding (43 chars), as required by POST /v1/register. */
    String publicKeyB64u() { return AmsClient.b64u(pub); }

    byte[] sign(byte[] message) {
        Ed25519Signer signer = new Ed25519Signer();
        signer.init(true, priv);
        signer.update(message, 0, message.length);
        return signer.generateSignature();
    }

    // --- AndroidKeyStore AES-GCM wrap of the seed ---

    private static SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KS);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS);
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    private static byte[] wrap(byte[] seed) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, wrapKey());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(seed);
        byte[] out = new byte[1 + iv.length + ct.length];
        out[0] = (byte) iv.length;
        System.arraycopy(iv, 0, out, 1, iv.length);
        System.arraycopy(ct, 0, out, 1 + iv.length, ct.length);
        return out;
    }

    private static byte[] unwrap(byte[] blob) throws Exception {
        int ivLen = blob[0] & 0xFF;
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(128, blob, 1, ivLen));
        return c.doFinal(blob, 1 + ivLen, blob.length - 1 - ivLen);
    }

    private static byte[] readAll(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[256];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static void writeAll(File f, byte[] data) throws Exception {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new java.io.IOException("rename failed");
    }
}
