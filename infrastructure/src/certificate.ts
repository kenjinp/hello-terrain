import * as aws from "@pulumi/aws";

export function certificateValidation(
  domain: string,
  domainName: string,
  environment: string,
  zoneId: Promise<string>
): aws.acm.CertificateValidation {
  // BEGIN provision ACM certificate
  // this will be used to verify we own the domain and can secure it with SSL
  const tenMinutes = 60 * 10;

  const eastRegion = new aws.Provider("east", {
    profile: aws.config.profile,
    region: "us-east-1", // Per AWS, ACM certificate must be in the us-east-1 region.
  });

  const certificateConfig: aws.acm.CertificateArgs = {
    domainName,
    validationMethod: "DNS",
    subjectAlternativeNames: [],
    tags: {
      Environment: environment,
      Project: "hello-terrain",
      Domain: domain,
    },
  };

  const sslCertificate = new aws.acm.Certificate(
    "hello-terrain-ssl-cert",
    certificateConfig,
    { provider: eastRegion }
  );
  // Create DNS record to prove to ACM that we own the domain
  const sslCertificateValidationDnsRecord = new aws.route53.Record(
    "hello-terrain-ssl-cert-validation-dns-record",
    {
      zoneId: zoneId,
      name: sslCertificate.domainValidationOptions[0].resourceRecordName,
      type: sslCertificate.domainValidationOptions[0].resourceRecordType,
      records: [sslCertificate.domainValidationOptions[0].resourceRecordValue],
      ttl: tenMinutes,
    }
  );
  // Wait for the certificate validation to succeed
  const validatedSslCertificate = new aws.acm.CertificateValidation(
    "hello-terrain-ssl-cert-validation",
    {
      certificateArn: sslCertificate.arn,
      validationRecordFqdns: [sslCertificateValidationDnsRecord.fqdn],
    },
    { provider: eastRegion }
  );

  return validatedSslCertificate;
}
