import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { CombinedFargateResource, PORTS } from "../typedefs/ecs";

interface CombinedResourceItem {
  targetGroup?: aws.lb.TargetGroup;
  listenerRule?: aws.lb.ListenerRule;
  internalPort: number;
}

interface CombinedResourcesMap {
  [key: string]: CombinedResourceItem;
}

export { CombinedFargateResource, PORTS };

export class ECSFargateCluster {
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
  }) {
    const stage = getCorrectStage(props?.stage);
    this.stage = stage;
    // Get an existing domain Certificate
    this.certificate = aws.acm.getCertificateOutput({
      domain: props.certificateDomain,
      statuses: ["ISSUED"],
    });

    this.combinedResourcesArray = props.combinedResources;

    const vpc = new awsx.ec2.DefaultVpc(`${props.resourceNamingPrefix}-${stage}-vpc`);

    // An ECS cluster to deploy into
    this.cluster = new aws.ecs.Cluster(props.clusterName, {}, { dependsOn: [vpc] });

    // Create an application load balancer with SSL support.
    this.applicationLoadBalancer = new awsx.lb.ApplicationLoadBalancer(
      `${props.resourceNamingPrefix}-${stage}-lb`,
      {}
    );

    let combinedResources: CombinedResourcesMap = {};

    const httpsListener = ECSFargateCluster.setupHttpsListener(
      `https-listener-${stage}`,
      this.applicationLoadBalancer,
      this.certificate.arn
    );

    //store all target groups in a map for easy access via its name
    props.combinedResources.forEach(({ name, port }) => {
      const containerTargetGroup = new aws.lb.TargetGroup(
        `${name}-${stage}-tg`,
        {
          port,
          protocol: "HTTP",
          targetType: "ip",
          vpcId: vpc.vpcId,
        },
        { dependsOn: [httpsListener, this.applicationLoadBalancer, this.cluster] }
      );

      combinedResources[name] = {
        targetGroup: containerTargetGroup,
        internalPort: port,
        listenerRule: new aws.lb.ListenerRule(
          `${name}-${stage}-rule`,
          {
            actions: [{ type: "forward", targetGroupArn: containerTargetGroup.arn }],
            conditions: [
              { hostHeader: { values: [`${name}-${stage}.${props.certificateDomain}`] } },
            ],
            listenerArn: httpsListener.arn,
          },
          { dependsOn: [httpsListener, containerTargetGroup, this.cluster] }
        ),
      };
    });

    this.combinedResources = combinedResources;
  }

  /**
   *  A static function to retrieve a certificate from ACM (Amazon Certificate Manager) based on its associated domain name
   *  @param {string} domain - The associated domain name of the certificate
   *  @returns {string} An AWS ACM Certificate ARN
   *
   */
  static getACMCertificateARN(domain: string): string | pulumi.Output<string> {
    // Get an existing domain Certificate
    const certificate = aws.acm.getCertificateOutput({
      domain: domain,
      statuses: ["ISSUED"],
    });

    return certificate.arn;
  }

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
    loadBalancer: awsx.lb.ApplicationLoadBalancer,
    certificateArn: string | pulumi.Input<string>
  ): aws.lb.Listener {
    return new aws.lb.Listener(
      listenerName,
      {
        loadBalancerArn: loadBalancer.loadBalancer.arn,
        port: PORTS.SSH,
        protocol: "HTTPS",
        certificateArn: certificateArn,
        defaultActions: [
          {
            type: "fixed-response",
            fixedResponse: {
              contentType: "text/plain",
              messageBody: "Fixed response content",
              statusCode: "200",
            },
          },
        ],
      },
      { dependsOn: [loadBalancer] }
    );
  }

  /**
   * An instance version of the static function (setupHttpsListener)
   * This will setup an HTTPS listener for your ECS or Fargate Load Balancer using the certificate and load balancer set up for this instance.
   * AWS' ACM
   *
   * @param {string} listenerName - The name/id of the listener.
   * @returns {aws.lb.Listener} An aws listener
   */
  setupHttpsListener(listenerName: string): aws.lb.Listener {
    return ECSFargateCluster.setupHttpsListener(
      listenerName,
      this.applicationLoadBalancer,
      this.certificate.arn
    );
  }

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
  }): awsx.ecs.FargateService {
    const associatedTargetGroup = this.combinedResources[props.name].targetGroup;
    const associatedPort = this.combinedResources[props.name].internalPort;

    let containers: { [key: string]: any } = {};

    const desiredCount =
      props?.desiredCount === undefined || props?.desiredCount < 1 ? 1 : props?.desiredCount;

    containers[props.name] = {
      name: props.name,
      image: props.image,
      cpu: props.cpuSize,
      memory: props.memorySize,
      essential: props?.essential,
      environment: props?.environment,
      portMappings: [
        {
          containerPort: associatedPort,
          hostPort: associatedPort,
          targetGroup: associatedTargetGroup,
        },
      ],
    };

    const fargateService = new awsx.ecs.FargateService(`service-${props.name}-${this.stage}`, {
      cluster: this.cluster.arn,
      desiredCount,
      continueBeforeSteadyState: true,
      assignPublicIp: true,
      taskDefinitionArgs: { containers },
      loadBalancers: [
        {
          targetGroupArn: associatedTargetGroup?.arn,
          containerName: props.name,
          containerPort: associatedPort,
        },
      ],
    });

    return fargateService;
  }

  static createRoute53SubdomainRecords(
    fargateResourceArray: CombinedFargateResource[],
    loadBalancer: awsx.lb.ApplicationLoadBalancer,
    hostedZoneId: string,
    baseDomain: string,
    stage?: string
  ): { [key: string]: string } {
    const aStage = getCorrectStage(stage);

    let urls: { [key: string]: string } = {};

    fargateResourceArray.forEach((fargateResource) => {
      const { name } = fargateResource;

      const domain = ECSFargateCluster.createRoute53SubdomainRecord(
        fargateResource,
        loadBalancer,
        hostedZoneId,
        baseDomain,
        aStage
      );

      urls[name] = domain;
    });

    return urls;
  }

  static createRoute53SubdomainRecord(
    fargateResource: CombinedFargateResource,
    loadBalancer: awsx.lb.ApplicationLoadBalancer,
    hostedZoneId: string,
    baseDomain: string,
    stage?: string
  ): string {
    const { name } = fargateResource;
    const aStage = getCorrectStage(stage);
    const domainUrl = getServiceDomainUrl(name, baseDomain, aStage);

    new aws.route53.Record(`${name}-${aStage}-subdomain`, {
      name: domainUrl,
      type: "A",
      aliases: [
        {
          name: loadBalancer.loadBalancer.dnsName,
          zoneId: loadBalancer.loadBalancer.zoneId,
          evaluateTargetHealth: true,
        },
      ],
      zoneId: hostedZoneId,
    });

    return domainUrl;
  }

  createRoute53SubdomainRecords(hostedZoneId: string, baseDomain: string, stage?: string) {
    const result = ECSFargateCluster.createRoute53SubdomainRecords(
      this.combinedResourcesArray,
      this.applicationLoadBalancer,
      hostedZoneId,
      baseDomain,
      stage
    );

    return result;
  }
}

//========================================== HELPER FUNCTIONS ======================================

function getCorrectStage(stage?: string): string {
  return stage ?? "dev";
}

function getIsStageProduction(stage?: string): boolean {
  const lowercaseStage = getCorrectStage(stage).toLowerCase();
  const isProduction = lowercaseStage.includes("prod") || lowercaseStage.includes("live");
  return isProduction;
}

function getServiceDomainUrl(serviceName: string, baseDomain: string, stage?: string): string {
  const isProduction = getIsStageProduction(stage);
  const aStage = getCorrectStage(stage);
  const url = isProduction
    ? `${serviceName}.${baseDomain}`
    : `${serviceName}-${aStage}.${baseDomain}`;
  return url;
}
