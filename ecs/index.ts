import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { CombinedFargateResource, PORTS } from "../types";

interface CombinedResourceItem {
  targetGroup?: aws.lb.TargetGroup;
  listenerRule?: aws.lb.ListenerRule;
  internalPort: number;
}

interface CombinedResourcesMap {
  [key: string]: CombinedResourceItem;
}

export class ECSFargateCluster {
  certificate: pulumi.Output<aws.acm.GetCertificateResult>;
  cluster: aws.ecs.Cluster;
  applicationLoadBalancer: awsx.lb.ApplicationLoadBalancer;
  combinedResources: CombinedResourcesMap;
  combinedResourcesArray: CombinedFargateResource[];

  constructor(props: {
    resourceNamingPrefix: string;
    certificateDomain: string | pulumi.Input<string>;
    clusterName: string;
    combinedResources: CombinedFargateResource[];
  }) {
    // Get an existing domain Certificate
    this.certificate = aws.acm.getCertificateOutput({
      domain: props.certificateDomain,
      statuses: ["ISSUED"],
    });

    this.combinedResourcesArray = props.combinedResources;

    const vpc = new awsx.ec2.DefaultVpc(`${props.resourceNamingPrefix}-vpc`);

    // Create an application load balancer with SSL support.
    this.applicationLoadBalancer = new awsx.lb.ApplicationLoadBalancer(
      `${props.resourceNamingPrefix}-lb`,
      {}
    );

    const loadBalancerArn = this.applicationLoadBalancer.loadBalancer.arn;

    let combinedResources: CombinedResourcesMap = {};

    const httpsListener = ECSFargateCluster.setupHttpsListener(
      `https-listener`,
      loadBalancerArn,
      this.certificate.arn
    );

    //store all target groups in a map for easy access via its name
    props.combinedResources.forEach(({ name, port }) => {
      const containerTargetGroup = new aws.lb.TargetGroup(`${name}-tg`, {
        port,
        protocol: "HTTP",
        targetType: "ip",
        vpcId: vpc.vpcId,
      });

      combinedResources[name] = {
        targetGroup: containerTargetGroup,
        internalPort: port,
        listenerRule: new aws.lb.ListenerRule(`${name}-rule`, {
          actions: [{ type: "forward", targetGroupArn: containerTargetGroup.arn }],
          conditions: [{ hostHeader: { values: [`${name}.${props.certificateDomain}`] } }],
          listenerArn: httpsListener.arn,
        }),
      };
    });

    this.combinedResources = combinedResources;

    // An ECS cluster to deploy into
    this.cluster = new aws.ecs.Cluster(props.clusterName, {}, { dependsOn: [vpc] });
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
    loadBalancerArn: string | pulumi.Input<string>,
    certificateArn: string | pulumi.Input<string>
  ): aws.lb.Listener {
    return new aws.lb.Listener(listenerName, {
      loadBalancerArn: loadBalancerArn,
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
    });
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
      this.applicationLoadBalancer.loadBalancer.arn,
      this.certificate.arn
    );
  }

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

    const fargateService = new awsx.ecs.FargateService(`service-${props.name}`, {
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
    baseDomain: string
  ) {
    fargateResourceArray.forEach(({ name }) => {
      new aws.route53.Record(`${name}-subdomain`, {
        name: `${name}.${baseDomain}`,
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
    });
  }

  createRoute53SubdomainRecords(hostedZoneId: string, baseDomain: string) {
    ECSFargateCluster.createRoute53SubdomainRecords(
      this.combinedResourcesArray,
      this.applicationLoadBalancer,
      hostedZoneId,
      baseDomain
    );
  }
}
