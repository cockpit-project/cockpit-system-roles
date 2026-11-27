/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState, useEffect } from 'react';

import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Tbody, Tr, TrProps, Td, ExpandableRowContent } from '@patternfly/react-table';
import { Dropdown } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { MenuToggle } from '@patternfly/react-core/dist/esm/components/MenuToggle/index.js';
import { EllipsisVIcon } from '@patternfly/react-icons';
import { ExpandableSection, ExpandableSectionVariant } from '@patternfly/react-core/dist/esm/components/ExpandableSection';

import Markdown from "markdown-to-jsx";

import { FileChooserInput, FileChooserProps } from 'cockpit/react/FileChooser';
import { useObject } from 'hooks';

const _ = cockpit.gettext;

export function shortenstart(prefix: string, val: string): string {
    if (val.startsWith(prefix))
        return val.substring(prefix.length);
    else
        return val;
}

export function short_role_name(long_name: string) {
    return shortenstart("linux-system-roles.", long_name);
}

export function JSON_parse_carefully(input: string, def?: unknown): unknown {
    try {
        return JSON.parse(input);
    } catch {
        return def;
    }
}

function same_typeof<T>(a: unknown, b: T): a is T {
    return typeof a === typeof b;
}

export function JSON_parse_type<T>(input: string, def: T): T {
    const v = JSON_parse_carefully(input);
    if (same_typeof(v, def))
        return v;
    else
        return def;
}

export const ExpandableTr = ({
    rowIndex,
    expandableContent,
    children,
    ...props
} : {
    rowIndex: number,
    expandableContent: React.ReactNode,
    children: React.ReactNode[],
} & Omit<TrProps, "children">) => {
    const [expanded, setExpanded] = useState<boolean>(false);

    return (
        <Tbody isExpanded={expanded}>
            <Tr {...props}>
                <Td
                    expand={
                        {
                            rowIndex,
                            isExpanded: expanded,
                            onToggle: () => {
                                setExpanded(!expanded);
                            }
                        }
                    }
                />
                { children }
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={children.length + 1}>
                    <ExpandableRowContent>
                        { expandableContent }
                    </ExpandableRowContent>
                </Td>
            </Tr>
        </Tbody>
    );
};

class Debouncer {
    #timeout: number = 0;
    #func: (() => Promise<void>) | null = null;
    #promise: Promise<void> | null = null;

    static debouncers = new Set<Debouncer>();

    constructor() {
        Debouncer.debouncers.add(this);
    }

    destroy() {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        Debouncer.debouncers.delete(this);
    }

    #start() {
        if (this.#func)
            this.#promise = this.#func().then(() => { this.#promise = null });
        this.#func = null;
    }

    trigger(delay: number, func: () => Promise<void>): void {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        this.#func = func;
        this.#timeout = window.setTimeout(
            async () => {
                this.#timeout = 0;
                this.#start();
            },
            delay,
        );
    }

    async run_now () {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        if (!this.#promise)
            this.#start();
        if (this.#promise)
            await this.#promise;
    }
}

export function useDebouncer() {
    return useObject(
        () => new Debouncer(),
        db => db.destroy(),
        [],
    );
}

export async function run_debouncers_now() {
    for (const db of Debouncer.debouncers.values())
        await db.run_now();
}

export const DebouncedTextInput = ({
    value,
    onChange,
    placeholder,
    disabled,
} : {
    value: string,
    onChange: (val: string) => Promise<void>,
    placeholder?: string,
    disabled: boolean,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const debouncer = useDebouncer();

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <TextInput
            value={localValue}
            isDisabled={disabled}
            onChange={
                (_event, val) => {
                    setLocalValue(val);
                    debouncer.trigger(500, () => onChange(val));
                }
            }
            {...placeholder ? { placeholder } : {}}
        />
    );
};

export const DebouncedFileChooserInput = ({
    value,
    onChange,
    fileChooserProps,
    disabled,
} : {
    value: string,
    onChange: (val: string) => Promise<void>,
    fileChooserProps: FileChooserProps,
    disabled: boolean,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const debouncer = useDebouncer();

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <FileChooserInput
            isDisabled={disabled}
            value={localValue}
            onChange={
                (val, fromDialog) => {
                    setLocalValue(val);
                    if (!fromDialog)
                        debouncer.trigger(500, () => onChange(val));
                    else
                        debouncer.trigger(0, () => onChange(val));
                }
            }
            fileChooserProps={fileChooserProps}
        />
    );
};

export const TwoResizableColumns = ({
    children,
} : {
    children: React.ReactNode[],
}) => {
    const left = children[0];
    const right = children.slice(1);

    // TODO - Make this actually resizable.  For now we fix this at
    // 1/3 left, 2/3 right, see app.css.

    return (
        <div className="ct-resizable-columns">
            <div className="ct-resizable-left">
                {left}
            </div>
            <div className="ct-resizable-right">
                {right}
            </div>
        </div>
    );
};

export const KebabMenu = ({
    ariaLabel,
    children
} : {
    ariaLabel: string,
    children: React.ReactNode
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Dropdown
            isOpen={isOpen}
            onSelect={() => setIsOpen(false)}
            onOpenChange={isOpen => setIsOpen(isOpen)}
            toggle={
                ref => (
                    <MenuToggle
                        ref={ref}
                        variant="plain"
                        onClick={() => setIsOpen(!isOpen)}
                        isExpanded={isOpen}
                        aria-label={ariaLabel}
                    >
                        <EllipsisVIcon />
                    </MenuToggle>
                )
            }
            popperProps={{ position: "right" }}
            shouldFocusToggleOnSelect
        >
            {children}
        </Dropdown>
    );
};

export const Description = ({
    children
} : {
    children: string | string[] | undefined
}) => {
    const [showAll, setShowAll] = useState(false);

    const options = {
        overrides: {
            a: {
                props: {
                    rel: "noopener noreferrer",
                    target: "_blank",
                },
            },
            // XXX - PatternFly messes with CSS so that for example
            // <ul> doesn't get bullets. We probably need to configure
            // Markdown to use PF text markup instead of the standard
            // HTML one. Trying to undo PF CSS changes is the wrong
            // approach.
            ul: {
                props: {
                    style: { listStyle: "inside" },
                }
            }
        },
    };

    if (children) {
        const text = Array.isArray(children) ? children.join("\n\n") : children;
        return (
            <ExpandableSection
                variant={ExpandableSectionVariant.truncate}
                toggleTextCollapsed={_("Show more")}
                toggleTextExpanded={_("Show less")}
                onToggle={() => setShowAll(flag => !flag)}
                truncateMaxLines={3}
                isExpanded={showAll}
            >
                <Markdown options={options}>
                    { text }
                </Markdown>
            </ExpandableSection>
        );
    }
};

export const WithExcuse = ({
    id,
    excuse,
    children,
} : {
    id: string,
    excuse: string | undefined | false | null,
    children: React.ReactElement,
}) => {
    if (!excuse)
        return children;

    return (
        <Tooltip
            id={id}
            content={excuse}
            position={TooltipPosition.top}
        >
            {children}
        </Tooltip>
    );
};
