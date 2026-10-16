/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import { useState, useEffect } from "react";
import cockpit from "cockpit";

import { toaster } from "./toaster";

const _ = cockpit.gettext;

/* CONFIGURATION

   The user constructs a simple playbook via the UI that consists of a
   couple of plays.  Each play refers to a singhle system role and
   specifies the variables for it.  A simple example might look like
   this:

       - name: linux-system-roles.nbde_server
         hosts: all
         vars:
           nbde_server_port: 88
           nbde_server_manage_selinux: true
           nbde_server_firewall_zone: virt
         roles:
           - linux-system-roles.nbde_server
       - name: linux-system-roles.firewall
         hosts: all
         vars: {}
         roles:
           - linux-system-roles.firewall

   This playbook will run the "nbde_server" system role with
   "nbde_server_port" set to 88, for example.  The "firewall" role is
   executed with its defaults.

   The user is contructing this playbook incrementally and we save the
   state of that after each keypress (there is debouncing of course).
   Thus, we need to be able to represent intermediate invalid
   playbooks as well, such as when the user types "8 8" instead of a
   valid number.

   Thus, we store the application state in our custom format and
   create a playbook from it only once we actually run it.

   And even if a different UI approach would make it unnecessary to
   store intermediate invalid input, we are of the opinion that
   storing the Application state as a playbook is unneccessary and too
   restricting.

   The custom format is a JSON object with the structure described
   below, and saved in "/etc/cockpit/system-roles.json".

   The most interesting bit is that variable values are always stored
   in it in their JSON serialization.  For example, the "int" value 80
   for "nbde_server_port" is stored as JSON.stringify(80), which is
   "80".  Likewise a string value like "virt" above for
   "nbde_server_firewall_zone" is stored as JSON.stringify("virt"),
   which is "\"virt\"".


   The API for accessing the stored state is a React hook for reading
   and a couple functions for updating.  There should be only one use
   of the hook in the whole application.  Updating works without
   mutating the existing state value.
 */

export interface VarConfig {
    value: string; // Always JSON, but maybe not valid
}

export interface RoleConfig {
    name: string;
    vars: Record<string, VarConfig>;
}

export interface Config {
    roles: RoleConfig[];
}

export class AppConfig {
    #file: cockpit.FileHandle<unknown>;
    #tag: string;

    config: Config;

    constructor (file: cockpit.FileHandle<unknown>, data: unknown, tag: string) {
        this.#file = file;
        this.#tag = tag;
        this.config = data as Config;
    }

    async modify(func: (old: Config) => Config) {
        await this.#file.replace(func(this.config), this.#tag);
    }
}

export const useAppConfig = () => {
    const [config, setConfig] = useState<AppConfig | Error | null>(null);

    useEffect(
        () => {
            const file: cockpit.FileHandle<unknown> = cockpit.file(
                "/etc/cockpit/system-roles.json",
                { syntax: JSON, superuser: "require" }
            );

            file.watch(
                (data, tag, error) => {
                    if (error)
                        setConfig(new Error(error.message));
                    else {
                        cockpit.assert(tag);
                        if (data)
                            setConfig(new AppConfig(file, data, tag));
                        else
                            setConfig(new AppConfig(file, { roles: [] }, tag));
                    }
                }
            );
        },
        [],
    );

    return config;
};

export async function update_variable(config: AppConfig, role: RoleConfig, name: string, value: string) {
    function update_vars(vars: Record<string, VarConfig>) {
        if (value !== "")
            return {
                ...vars,
                [name]: { ...vars[name], value }
            };
        else {
            const new_vars = { ...vars };
            delete new_vars[name];
            return new_vars;
        }
    }

    function update_role(r: RoleConfig) {
        if (Object.is(r, role))
            return { ...r, vars: update_vars(r.vars) };
        else
            return r;
    }

    try {
        await config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.map(update_role)
                };
            }
        );
    } catch (ex) {
        toaster.add_error(_("Failed to update the configuration"), ex);
    }
}

export async function add_role(config: AppConfig, name: string) {
    try {
        await config.modify(conf => ({ ...conf, roles: [...conf.roles, { name, vars: {} } ]}));
    } catch (ex) {
        toaster.add_error(_("Failed to add role"), ex);
    }
}

export async function remove_role(config: AppConfig, name: string) {
    try {
        await config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.filter(r => r.name === name)
                };
            }
        );
    } catch (ex) {
        toaster.add_error(_("Failed to remove role"), ex);
    }
}
