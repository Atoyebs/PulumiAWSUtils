import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";

export interface TargetGroupInput {
  name: string;
  port: number;
}

export interface ListenerRules {
  subdomainPrefix?: string;
}

export enum PORTS {
  SSH = 443,
  TCP = 80,
}

export type CombinedFargateResource = TargetGroupInput &
  ListenerRules & {
    imageName: string;
    cpuSize: number;
    memorySize: number;
    desiredCount: number;
    environment?: pulumi.Input<pulumi.Input<awsx.types.input.ecs.TaskDefinitionKeyValuePairArgs>[]>;
  };
