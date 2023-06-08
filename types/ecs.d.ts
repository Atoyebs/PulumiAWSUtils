import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { CombinedFargateResource } from ".";


interface CombinedResourceItem {
  targetGroup?: aws.lb.TargetGroup;
  listenerRule?: aws.lb.ListenerRule;
  internalPort: number;
}
interface CombinedResourcesMap {
  [key: string]: CombinedResourceItem;
}
export declare class ECSFargateCluster {
  certificate: pulumi.Output<aws.acm.GetCertificateResult>;
  cluster: aws.ecs.Cluster;
  applicationLoadBalancer: awsx.lb.ApplicationLoadBalancer;
  combinedResources: CombinedResourcesMap;
  combinedResourcesArray: CombinedFargateResource[];
  stage: string;
  constructor(props: {
    resourceNamingPrefix: string;
    certificateDomain: string | pulumi.Input<string>;
    clusterName: string;
    combinedResources: CombinedFargateResource[];
    stage?: string;
  });
  /**
   *  A static function to retrieve a certificate from ACM (Amazon Certificate Manager) based on its associated domain name
   *  @param {string} domain - The associated domain name of the certificate
   *  @returns {string} An AWS ACM Certificate ARN
   *
   */
  static getACMCertificateARN(domain: string): string | pulumi.Output<string>;
  /**
   * A static function to setup an HTTPS listener for your ECS or Fargate Load Balancer. This is important
   * as this implementation will only work if you have a valid certificate to use, preferably one from
   * AWS' ACM
   *
   * @param {string} listenerName - The name/id of the listener.
   * @param {string} loadBalancerArn - The ARN (Amazon Resource Name) of the load balancer.
   * @param {string} certificateArn - The ARN of the SSL/TLS certificate.
   * @returns {aws.lb.Listener} An aws listener
   */
  static setupHttpsListener(
    listenerName: string,
    loadBalancerArn: string | pulumi.Input<string>,
    certificateArn: string | pulumi.Input<string>
  ): aws.lb.Listener;
  /**
   * An instance version of the static function (setupHttpsListener)
   * This will setup an HTTPS listener for your ECS or Fargate Load Balancer using the certificate and load balancer set up for this instance.
   * AWS' ACM
   *
   * @param {string} listenerName - The name/id of the listener.
   * @returns {aws.lb.Listener} An aws listener
   */
  setupHttpsListener(listenerName: string): aws.lb.Listener;
  /**
   * Adds a service to the already configured to manage the spinning up and
   * lifecycle of the defined task. This service will be added to the cluster that was
   * created at the instantiation of the ECSFargateCluster class. This function should only be used
   * with a particular ECSFargate instance
   *
   * @returns {awsx.ecs.FargateService} An ECS Fargate service object
   */
  addServiceToCluster(props: {
    name: string;
    image: string;
    cpuSize: number;
    memorySize: number;
    essential: boolean;
    desiredCount?: number;
    environment?: pulumi.Input<pulumi.Input<awsx.types.input.ecs.TaskDefinitionKeyValuePairArgs>[]>;
  }): awsx.ecs.FargateService;
  static createRoute53SubdomainRecords(
    fargateResourceArray: CombinedFargateResource[],
    loadBalancer: awsx.lb.ApplicationLoadBalancer,
    hostedZoneId: string,
    baseDomain: string,
    stage?: string
  ): {
    [key: string]: string;
  };
  static createRoute53SubdomainRecord(
    fargateResource: CombinedFargateResource,
    loadBalancer: awsx.lb.ApplicationLoadBalancer,
    hostedZoneId: string,
    baseDomain: string,
    stage?: string
  ): string;
  createRoute53SubdomainRecords(
    hostedZoneId: string,
    baseDomain: string,
    stage?: string
  ): {
    [key: string]: string;
  };
}
