import * as pulumi from "@pulumi/pulumi";

export interface InfrastructureConfig {
    domain: string;
    environment: string;
    domainName: string;
    parentDomain: string;
    subdomain: string;
}

export function getConfig(): InfrastructureConfig {
    // Configuration
    const config = new pulumi.Config();
    const domain = config.get("domain") || process.env.DOMAIN || "hello-terrain.kenny.wtf";
    const environment = config.get("environment") || process.env.ENVIRONMENT || "dev";

    // Route 53 configuration
    const route53Config = new pulumi.Config("route53");
    const domainName = route53Config.get("domainName") || process.env.DOMAIN_NAME || domain;

    // Extract domain parts
    const domainParts = domainName.split(".");
    const parentDomain = domainParts.slice(-2).join("."); // Get parent domain (e.g., "kenny.wtf")
    const subdomain = domainParts.length > 2 ? domainParts.slice(0, -2).join(".") : ""; // Get subdomain if exists

    return {
        domain,
        environment,
        domainName,
        parentDomain,
        subdomain,
    };
}
