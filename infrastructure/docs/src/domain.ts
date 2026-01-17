import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { InfrastructureConfig } from "./config.js";

export interface DomainResources {
    hostedZone: Promise<aws.route53.GetZoneResult>;
    hostedZoneId: Promise<string>;
    dnsRecord: aws.route53.Record;
}

export function createDomain(
    config: InfrastructureConfig,
    distributionDomain: pulumi.Output<string>,
    distributionHostedZoneId: pulumi.Output<string>
): DomainResources {
    const { domainName, parentDomain } = config;

    // Get Route 53 hosted zone automatically
    const hostedZone = aws.route53.getZone({
        name: parentDomain,
    }, { async: true });

    const hostedZoneId = hostedZone.then(zone => zone.zoneId);

    // Create Route 53 DNS record
    const dnsRecord = new aws.route53.Record("hello-terrain-dns", {
        zoneId: hostedZoneId,
        name: domainName,
        type: "A",
        aliases: [{
            name: distributionDomain,
            zoneId: distributionHostedZoneId,
            evaluateTargetHealth: false,
        }],
    });

    return {
        hostedZone,
        hostedZoneId,
        dnsRecord,
    };
}
