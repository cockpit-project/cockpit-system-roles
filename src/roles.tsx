/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import { useState, useEffect } from "react";
import * as python from "python";

import discover_system_roles_py from "./discover-system-roles.py";

/* SYSTEM ROLES

   We present the user with a lot of data about the system roles that
   they are putting into their playbook.  This data is read from two
   files.

       /usr/share/ansible/roles/<role>/meta/main.yml
       /usr/share/ansible/roles/<role>/meta/arguments_spec.yml

   The format of these files is specified by Ansible and we encode it
   as TypeScript interfaces below.  But only the pieces we care about,
   of course.

   The arguments_spec.yml format is documented here, and maybe elsewhere:

       https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-argument-spec
       https://docs.ansible.com/projects/ansible/latest/dev_guide/developing_program_flow_modules.html#argument-spec

   The roles are found in the filesystem and turned into JSON by a
   very small Python script since that seems to be the easiest way to
   parse YAML for us.

   This discovery is done only once on application startup. If the
   installed roles change, the user needs to reload the browser.
 */

export interface Option {
    type?: string,
    description?: string,
    default?: string,
    choices?: string[],
}

interface ArgumentSpecs {
    short_description?: string,
    description?: string,
    options?: Record<string, Option>,
}

interface Meta {
    galaxy_info?: {
        description?: string;
    }
}

export interface SystemRole {
    name: string,
    meta: null | Meta,
    arguments: null | {
        argument_specs: Record<string, ArgumentSpecs>,
    },
}

interface DiscoverResult {
    roles: SystemRole[];
}

async function discover_system_roles(): Promise<DiscoverResult> {
    return JSON.parse(await python.spawn(discover_system_roles_py, [], { superuser: "try" }));
}

export type SystemRoles = Record<string, SystemRole>;

export const useSystemRoles = () => {
    const [roles, setRoles] = useState<SystemRoles | Error | null>(null);

    useEffect(
        () => {
            async function doit() {
                try {
                    const result = await discover_system_roles();
                    setRoles(Object.fromEntries(result.roles.map(r => [r.name, r])));
                } catch (ex) {
                    setRoles(new Error(String(ex)));
                }
            }

            doit();
        },
        [],
    );

    return roles;
};
