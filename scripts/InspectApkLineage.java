import com.android.apksig.ApkVerifier;
import com.android.apksig.SigningCertificateLineage;
import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.List;

public final class InspectApkLineage {
  private static String sha256(X509Certificate certificate) throws Exception {
    byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
    StringBuilder value = new StringBuilder(digest.length * 2);
    for (byte item : digest) {
      value.append(String.format("%02x", item & 0xff));
    }
    return value.toString();
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) {
      throw new IllegalArgumentException("Expected one APK path");
    }
    ApkVerifier.Result result = new ApkVerifier.Builder(new File(args[0])).build().verify();
    if (!result.isVerified()) {
      throw new IllegalStateException("APK signature verification failed");
    }
    List<X509Certificate> currentSigners = result.getSignerCertificates();
    if (currentSigners.size() != 1) {
      throw new IllegalStateException("Expected exactly one current signer");
    }
    SigningCertificateLineage lineage = result.getSigningCertificateLineage();
    List<X509Certificate> certificates = lineage == null
      ? currentSigners
      : lineage.getCertificatesInLineage();
    System.out.println("verified=true");
    System.out.println("lineage=" + (lineage != null));
    System.out.println("current=" + sha256(currentSigners.get(0)));
    for (X509Certificate certificate : certificates) {
      System.out.println("certificate=" + sha256(certificate));
    }
  }
}
